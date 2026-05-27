import json
import logging
from datetime import datetime, time, timedelta
from types import SimpleNamespace

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.contrib.auth.hashers import check_password, make_password
from django.db import ProgrammingError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import (
    Administradores,
    AgendaProfesional,
    Citas,
    Conversaciones,
    DisponibilidadProfesionalFecha,
    ExcepcionAgendaFecha,
    Mensajes,
    Pacientes,
    Preguntas,
    ProfesionalAgendaPoliticas,
    Profesionales,
    Cuestionarios,
    RegistrosEmocionales,
    Respuestas,
    Usuarios,
)

TOKEN_SALT = "mindlink-auth"
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
REGISTER_ALLOWED_ROLES = {"paciente", "profesional"}

DEFAULT_ANTELACION_MINUTOS = 30
DEFAULT_HORIZONTE_DIAS = 90
DEFAULT_DESCANSO_ENTRE_CITAS_MINUTOS = 0
DEFAULT_GRANULARIDAD_MINUTOS = 5
DURACION_MINIMA_SESION = 15
DURACION_MAXIMA_SESION = 480
GRANULARIDAD_MINIMA = 5
GRANULARIDAD_MAXIMA = 60
ESTADOS_CITA_DISPONIBLES = {"pendiente", "confirmada", "cancelada", "completada"}
ESTADOS_CITA_OCUPAN_SLOT = {"pendiente", "aceptada"}
MAX_PROXIMOS_SLOTS = 25
LOOKAHEAD_PROXIMOS_DIAS = 30

logger = logging.getLogger(__name__)


def _normalizar_estado_cita(estado_raw):
    estado = str(estado_raw or "").strip().lower()
    if estado == "aceptada":
        return "confirmada"
    return estado


def _estado_cita_a_db(estado_raw):
    estado = str(estado_raw or "").strip().lower()
    if estado == "confirmada":
        return "aceptada"
    return estado


def _politicas_profesional(profesional):
    try:
        p = ProfesionalAgendaPoliticas.objects.get(profesional=profesional)
        descanso_val = DEFAULT_DESCANSO_ENTRE_CITAS_MINUTOS
        granularidad_val = DEFAULT_GRANULARIDAD_MINUTOS
        # Compatibilidad con esquemas legacy donde estas columnas no existen.
        if hasattr(p, "descanso_entre_citas_minutos") and getattr(p, "descanso_entre_citas_minutos") is not None:
            descanso_val = int(p.descanso_entre_citas_minutos)
        if hasattr(p, "granularidad_minutos") and getattr(p, "granularidad_minutos") is not None:
            granularidad_val = int(p.granularidad_minutos)
        return (
            int(p.antelacion_minima_minutos),
            int(p.horizonte_maximo_dias),
            descanso_val,
            granularidad_val,
        )
    except (ProfesionalAgendaPoliticas.DoesNotExist, ProgrammingError):
        return (
            DEFAULT_ANTELACION_MINUTOS,
            DEFAULT_HORIZONTE_DIAS,
            DEFAULT_DESCANSO_ENTRE_CITAS_MINUTOS,
            DEFAULT_GRANULARIDAD_MINUTOS,
        )


def _parse_hora(value):
    if hasattr(value, "hour"):
        return value
    raw = str(value).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    raise ValueError("hora invalida")


def _rangos_solapan(inicio_a, fin_a, inicio_b, fin_b):
    return inicio_a < fin_b and inicio_b < fin_a


def _bloques_agenda_para_fecha(profesional, fecha_obj):
    """Combina plantilla semanal con tramos por fecha salvo que el profesional marque
    explicitamente 'solo este dia' para esa fecha (solo tramos puntuales, sin plantilla)."""
    semanal = list(
        AgendaProfesional.objects.filter(
            profesional=profesional,
            dia_semana=fecha_obj.weekday(),
            activo=True,
        ).order_by("hora_inicio")
    )
    por_fecha = list(
        DisponibilidadProfesionalFecha.objects.filter(
            profesional=profesional,
            fecha=fecha_obj,
            activo=True,
        ).order_by("hora_inicio")
    )
    exc = ExcepcionAgendaFecha.objects.filter(
        profesional=profesional,
        fecha=fecha_obj,
    ).first()

    if exc and exc.solo_excepcion:
        return por_fecha

    combinados = semanal + por_fecha
    combinados.sort(key=lambda b: _parse_hora(b.hora_inicio))
    return combinados


def _validar_solapes_tramos(bloques):
    """bloques: lista de objetos con hora_inicio y hora_fin."""
    parsed = []
    for b in bloques:
        hi = _parse_hora(b.hora_inicio)
        hf = _parse_hora(b.hora_fin)
        if hf <= hi:
            return "Cada tramo debe tener hora_fin posterior a hora_inicio"
        parsed.append((hi, hf))
    for i, (a0, a1) in enumerate(parsed):
        for j in range(i + 1, len(parsed)):
            b0, b1 = parsed[j]
            if _rangos_solapan(a0, a1, b0, b1):
                return "Hay tramos que se solapan entre si"
    return None


def _alineado_a_granularidad(dt_value, granularidad_min):
    return (dt_value.minute % granularidad_min) == 0


def _intervalos_ocupados_profesional(profesional, fecha_obj):
    tz = timezone.get_current_timezone()
    day_start = timezone.make_aware(datetime.combine(fecha_obj, time.min), tz)
    day_end = day_start + timedelta(days=1)
    ocupados = []
    qs = Citas.objects.filter(
        profesional=profesional,
        fecha_hora__gte=day_start,
        fecha_hora__lt=day_end,
        estado__in=list(ESTADOS_CITA_OCUPAN_SLOT),
    ).values_list("fecha_hora", "duracion_min")
    for fh, duracion_min in qs:
        if fh is None:
            continue
        start = fh
        if timezone.is_naive(start):
            start = timezone.make_aware(start, tz)
        dm = int(duracion_min) if duracion_min else 50
        end = start + timedelta(minutes=dm)
        ocupados.append((start, end))
    return ocupados


def _intervalos_ocupados_paciente(paciente, fecha_obj):
    tz = timezone.get_current_timezone()
    day_start = timezone.make_aware(datetime.combine(fecha_obj, time.min), tz)
    day_end = day_start + timedelta(days=1)
    ocupados = []
    qs = Citas.objects.filter(
        paciente=paciente,
        fecha_hora__gte=day_start,
        fecha_hora__lt=day_end,
        estado__in=list(ESTADOS_CITA_OCUPAN_SLOT),
    ).values_list("fecha_hora", "duracion_min")
    for fh, duracion_min in qs:
        if fh is None:
            continue
        start = fh
        if timezone.is_naive(start):
            start = timezone.make_aware(start, tz)
        dm = int(duracion_min) if duracion_min else 50
        end = start + timedelta(minutes=dm)
        ocupados.append((start, end))
    return ocupados


def _solapa_con_ocupados(inicio, fin, ocupados):
    for o0, o1 in ocupados:
        if inicio < o1 and o0 < fin:
            return True
    return False


def _simular_bloques_dia_tramo_nuevo(profesional, fecha_obj, nuevo_hi, nuevo_hf, exclude_disp_id=None):
    semanal = list(
        AgendaProfesional.objects.filter(
            profesional=profesional,
            dia_semana=fecha_obj.weekday(),
            activo=True,
        )
    )
    por_qs = DisponibilidadProfesionalFecha.objects.filter(
        profesional=profesional,
        fecha=fecha_obj,
        activo=True,
    )
    if exclude_disp_id:
        por_qs = por_qs.exclude(id=int(exclude_disp_id))
    por_fecha = list(por_qs)
    virtual = SimpleNamespace(hora_inicio=nuevo_hi, hora_fin=nuevo_hf)
    por_con_nuevo = por_fecha + [virtual]

    exc = ExcepcionAgendaFecha.objects.filter(
        profesional=profesional,
        fecha=fecha_obj,
    ).first()

    if exc and exc.solo_excepcion:
        return por_con_nuevo

    combinados = semanal + por_con_nuevo
    combinados.sort(key=lambda b: _parse_hora(b.hora_inicio))
    return combinados


def health_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)
    return JsonResponse({"status": "ok", "service": "mindlink-api"}, status=200)


def _build_auth_token(usuario):
    return signing.dumps(
        {"user_id": usuario.id, "rol": usuario.rol},
        salt=TOKEN_SALT,
    )


def _get_authenticated_user(request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, JsonResponse({"detail": "Falta el token Bearer"}, status=401)

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None, JsonResponse({"detail": "Token Bearer invalido"}, status=401)

    try:
        payload = signing.loads(
            token,
            salt=TOKEN_SALT,
            max_age=TOKEN_MAX_AGE_SECONDS,
        )
    except SignatureExpired:
        return None, JsonResponse({"detail": "Token caducado"}, status=401)
    except BadSignature:
        return None, JsonResponse({"detail": "Token invalido"}, status=401)

    user_id = payload.get("user_id")
    if not user_id:
        return None, JsonResponse({"detail": "Payload del token invalido"}, status=401)

    try:
        usuario = Usuarios.objects.get(id=user_id)
    except Usuarios.DoesNotExist:
        return None, JsonResponse({"detail": "Usuario no encontrado"}, status=401)

    return usuario, None


def _verify_and_upgrade_password(usuario, raw_password):
    hashed_value = usuario.contrasena or ""

    if check_password(raw_password, hashed_value):
        return True

    # Compatibilidad temporal con contrasenas antiguas guardadas en texto plano.
    if hashed_value == raw_password:
        usuario.contrasena = make_password(raw_password)
        usuario.save(update_fields=["contrasena"])
        return True

    return False


def _require_admin(request):
    usuario, error_response = _get_authenticated_user(request)
    if error_response:
        return None, error_response

    if usuario.rol != "administrador":
        return None, JsonResponse({"detail": "Acceso denegado para este rol"}, status=403)

    return usuario, None


def _require_role(request, allowed_roles):
    usuario, error_response = _get_authenticated_user(request)
    if error_response:
        return None, error_response
    if usuario.rol not in allowed_roles:
        return None, JsonResponse({"detail": "Acceso denegado para este rol"}, status=403)
    return usuario, None


def _get_user_detail_payload(usuario):
    payload = {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol,
        "telefono": usuario.telefono,
        "dni": usuario.dni,
        "ciudad_residencia": usuario.ciudad_residencia,
        "activo": usuario.activo,
        "fecha_registro": usuario.fecha_registro,
    }

    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).values(
            "fecha_nacimiento",
            "telefono",
            "profesional_id",
        ).first()
        payload["paciente"] = paciente
    elif usuario.rol == "profesional":
        profesional = Profesionales.objects.filter(usuario=usuario).values(
            "especialidad",
        ).first()
        payload["profesional"] = profesional
    elif usuario.rol == "administrador":
        admin = Administradores.objects.filter(usuario=usuario).values(
            "perm_usuarios",
            "perm_cuestionarios",
            "perm_citas",
        ).first()
        payload["administrador"] = admin

    return payload


def _generate_slots_for_day(profesional, date_obj):
    antelacion_min, horizonte_dias, descanso_min, granularidad_min = _politicas_profesional(profesional)
    hoy = timezone.localdate()
    if date_obj < hoy:
        return []
    if date_obj > hoy + timedelta(days=horizonte_dias):
        return []

    agendas = _bloques_agenda_para_fecha(profesional, date_obj)
    slots = []
    now_dt = timezone.now()
    limite_reserva = now_dt + timedelta(minutes=antelacion_min)
    tz = timezone.get_current_timezone()
    ocupados = _intervalos_ocupados_profesional(profesional, date_obj)

    for agenda in agendas:
        hi = _parse_hora(agenda.hora_inicio)
        hf = _parse_hora(agenda.hora_fin)
        start_dt = timezone.make_aware(datetime.combine(date_obj, hi), tz)
        end_dt = timezone.make_aware(datetime.combine(date_obj, hf), tz)
        duracion_min = int(agenda.duracion_min)
        if duracion_min < DURACION_MINIMA_SESION or duracion_min > DURACION_MAXIMA_SESION:
            continue
        duration_delta = timedelta(minutes=duracion_min)
        descanso_delta = timedelta(minutes=max(0, descanso_min))
        step_delta = timedelta(minutes=max(granularidad_min, GRANULARIDAD_MINIMA))

        cursor = start_dt
        while cursor + duration_delta <= end_dt:
            slot_end = cursor + duration_delta
            if cursor < limite_reserva:
                cursor += step_delta
                continue
            if not _alineado_a_granularidad(cursor, max(granularidad_min, GRANULARIDAD_MINIMA)):
                cursor += step_delta
                continue
            if _solapa_con_ocupados(cursor, slot_end + descanso_delta, ocupados):
                cursor += step_delta
                continue
            slots.append(
                {
                    "inicio": cursor.isoformat(),
                    "fin": slot_end.isoformat(),
                    "duracion_min": duracion_min,
                    "precio": float(agenda.precio),
                    "source_block_id": getattr(agenda, "id", None),
                }
            )
            cursor += step_delta

    slots.sort(key=lambda s: s["inicio"])
    logger.info(
        "slots_generados",
        extra={
            "profesional_id": getattr(profesional, "id", None),
            "fecha": date_obj.isoformat(),
            "bloques": len(agendas),
            "slots": len(slots),
        },
    )
    return slots


def _proximos_slots_disponibles(profesional, desde_fecha, limite=MAX_PROXIMOS_SLOTS, dias_busqueda=LOOKAHEAD_PROXIMOS_DIAS):
    encontrados = []
    for delta in range(0, max(1, dias_busqueda)):
        if len(encontrados) >= limite:
            break
        fecha_obj = desde_fecha + timedelta(days=delta)
        slots_dia = _generate_slots_for_day(profesional, fecha_obj)
        for slot in slots_dia:
            encontrados.append(slot)
            if len(encontrados) >= limite:
                break
    return encontrados


@csrf_exempt
def login_view(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    email = payload.get("email")
    contrasena = payload.get("contrasena")

    if not email or not contrasena:
        return JsonResponse(
            {"detail": "Los campos 'email' y 'contrasena' son obligatorios"},
            status=400,
        )

    try:
        usuario = Usuarios.objects.get(email=email)
    except Usuarios.DoesNotExist:
        return JsonResponse({"detail": "Credenciales invalidas"}, status=401)

    if not usuario.activo:
        return JsonResponse({"detail": "Cuenta desactivada"}, status=403)

    if not _verify_and_upgrade_password(usuario, contrasena):
        return JsonResponse({"detail": "Credenciales invalidas"}, status=401)

    token = _build_auth_token(usuario)

    return JsonResponse(
        {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
            "telefono": usuario.telefono,
            "dni": usuario.dni,
            "ciudad_residencia": usuario.ciudad_residencia,
            "activo": usuario.activo,
            "token": token,
        },
        status=200,
    )


@csrf_exempt
def register_view(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    nombre = (payload.get("nombre") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    contrasena = payload.get("contrasena")
    rol = (payload.get("rol") or "").strip().lower()
    telefono = (payload.get("telefono") or "").strip()
    dni = (payload.get("dni") or "").strip().upper()
    ciudad_residencia = (payload.get("ciudad_residencia") or "").strip()
    fecha_nacimiento = payload.get("fecha_nacimiento")
    especialidad = (payload.get("especialidad") or "").strip()

    if not nombre or not email or not contrasena or not rol:
        return JsonResponse(
            {"detail": "Los campos 'nombre', 'email', 'contrasena' y 'rol' son obligatorios"},
            status=400,
        )

    if not telefono or not dni or not ciudad_residencia:
        return JsonResponse(
            {
                "detail": (
                    "Los campos 'telefono', 'dni' y 'ciudad_residencia' "
                    "son obligatorios para pacientes y profesionales"
                )
            },
            status=400,
        )

    if rol == "administrador":
        return JsonResponse(
            {"detail": "No esta permitido registrarse como administrador"},
            status=403,
        )

    if rol not in REGISTER_ALLOWED_ROLES:
        return JsonResponse(
            {"detail": "Rol invalido. Usa: paciente o profesional"},
            status=400,
        )

    if len(contrasena) < 8:
        return JsonResponse(
            {"detail": "La contrasena debe tener al menos 8 caracteres"},
            status=400,
        )

    if Usuarios.objects.filter(email=email).exists():
        return JsonResponse({"detail": "Ya existe un usuario con ese email"}, status=409)

    if Usuarios.objects.filter(dni=dni).exists():
        return JsonResponse({"detail": "Ya existe un usuario con ese DNI"}, status=409)

    if rol == "paciente" and not fecha_nacimiento:
        return JsonResponse(
            {"detail": "El campo 'fecha_nacimiento' es obligatorio para pacientes"},
            status=400,
        )

    if rol == "profesional" and not especialidad:
        return JsonResponse(
            {"detail": "El campo 'especialidad' es obligatorio para profesionales"},
            status=400,
        )

    usuario = Usuarios.objects.create(
        nombre=nombre,
        email=email,
        contrasena=make_password(contrasena),
        rol=rol,
        telefono=telefono,
        dni=dni,
        ciudad_residencia=ciudad_residencia,
        activo=True,
        fecha_registro=timezone.now(),
    )

    if rol == "paciente":
        Pacientes.objects.create(
            usuario=usuario,
            fecha_nacimiento=fecha_nacimiento,
            telefono=telefono,
            profesional=None,
        )
    elif rol == "profesional":
        Profesionales.objects.create(
            usuario=usuario,
            especialidad=especialidad,
        )

    token = _build_auth_token(usuario)

    return JsonResponse(
        {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
            "telefono": usuario.telefono,
            "dni": usuario.dni,
            "ciudad_residencia": usuario.ciudad_residencia,
            "activo": usuario.activo,
            "token": token,
        },
        status=201,
    )


def me_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    usuario, error_response = _get_authenticated_user(request)
    if error_response:
        return error_response

    return JsonResponse(
        {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
            "telefono": usuario.telefono,
            "dni": usuario.dni,
            "ciudad_residencia": usuario.ciudad_residencia,
            "activo": usuario.activo,
        },
        status=200,
    )


@csrf_exempt
def profile_view(request):
    usuario, error_response = _get_authenticated_user(request)
    if error_response:
        return error_response

    if request.method == "GET":
        return JsonResponse({"usuario": _get_user_detail_payload(usuario)}, status=200)

    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    allowed_base = {"nombre", "telefono", "ciudad_residencia"}
    updates = {}
    for key in allowed_base:
        if key in payload:
            updates[key] = (payload.get(key) or "").strip()
    if updates:
        for key, value in updates.items():
            setattr(usuario, key, value)
        usuario.save(update_fields=list(updates.keys()))

    if usuario.rol == "paciente" and any(k in payload for k in ("fecha_nacimiento", "telefono")):
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if paciente:
            p_updates = []
            if "telefono" in payload:
                paciente.telefono = (payload.get("telefono") or "").strip()
                p_updates.append("telefono")
            if "fecha_nacimiento" in payload and payload.get("fecha_nacimiento"):
                paciente.fecha_nacimiento = payload.get("fecha_nacimiento")
                p_updates.append("fecha_nacimiento")
            if p_updates:
                paciente.save(update_fields=p_updates)

    if usuario.rol == "profesional" and "especialidad" in payload:
        profesional = Profesionales.objects.filter(usuario=usuario).first()
        if profesional:
            profesional.especialidad = (payload.get("especialidad") or "").strip()
            profesional.save(update_fields=["especialidad"])

    return JsonResponse({"detail": "Perfil actualizado", "usuario": _get_user_detail_payload(usuario)}, status=200)


def admin_only_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    usuario, error_response = _require_admin(request)
    if error_response:
        return error_response

    return JsonResponse(
        {
            "detail": "Acceso concedido",
            "rol": usuario.rol,
            "pantalla_sugerida": "/panel-admin",
        },
        status=200,
    )


def admin_summary_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    now = timezone.now()
    limite_proximas = now + timedelta(days=7)
    citas_qs = Citas.objects.select_related("paciente__usuario", "profesional__usuario")

    citas_proximas_qs = citas_qs.filter(
        fecha_hora__gte=now,
        fecha_hora__lte=limite_proximas,
    ).exclude(estado="cancelada")

    ultimas_citas = []
    for c in citas_qs.order_by("-fecha_hora")[:6]:
        ultimas_citas.append(
            {
                "id": c.id,
                "fecha_hora": c.fecha_hora.isoformat(),
                "estado": _normalizar_estado_cita(c.estado),
                "paciente_nombre": c.paciente.usuario.nombre,
                "profesional_nombre": c.profesional.usuario.nombre,
            }
        )

    ultimos_usuarios = list(
        Usuarios.objects.order_by("-fecha_registro").values(
            "id", "nombre", "email", "rol", "fecha_registro", "activo"
        )[:6]
    )
    for row in ultimos_usuarios:
        fr = row.get("fecha_registro")
        row["fecha_registro"] = fr.isoformat() if fr else None

    return JsonResponse(
        {
            "total_usuarios": Usuarios.objects.count(),
            "total_pacientes": Usuarios.objects.filter(rol="paciente").count(),
            "total_profesionales": Usuarios.objects.filter(rol="profesional").count(),
            "total_administradores": Usuarios.objects.filter(rol="administrador").count(),
            "usuarios_activos": Usuarios.objects.filter(activo=True).count(),
            "usuarios_inactivos": Usuarios.objects.filter(activo=False).count(),
            "total_citas": citas_qs.count(),
            "citas_pendientes": citas_qs.filter(estado="pendiente").count(),
            # En BD el enum es pendiente | aceptada | cancelada ("confirmada" es alias en API).
            "citas_confirmadas": citas_qs.filter(estado="aceptada").count(),
            "citas_canceladas": citas_qs.filter(estado="cancelada").count(),
            "citas_proximas_7d": citas_proximas_qs.count(),
            "registros_emocionales": RegistrosEmocionales.objects.count(),
            "ultimas_citas": ultimas_citas,
            "ultimos_usuarios": ultimos_usuarios,
        },
        status=200,
    )


def admin_users_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    rol = (request.GET.get("rol") or "").strip().lower()
    search = (request.GET.get("q") or "").strip()

    queryset = Usuarios.objects.all().order_by("id")
    if rol:
        queryset = queryset.filter(rol=rol)
    if search:
        queryset = queryset.filter(
            Q(nombre__icontains=search)
            | Q(email__icontains=search)
            | Q(dni__icontains=search)
        )

    usuarios = list(
        queryset.values(
            "id",
            "nombre",
            "email",
            "rol",
            "telefono",
            "dni",
            "ciudad_residencia",
            "activo",
            "fecha_registro",
        )[:200]
    )

    return JsonResponse({"usuarios": usuarios}, status=200)


def admin_user_detail_view(request, user_id):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    try:
        usuario = Usuarios.objects.get(id=user_id)
    except Usuarios.DoesNotExist:
        return JsonResponse({"detail": "Usuario no encontrado"}, status=404)

    return JsonResponse({"usuario": _get_user_detail_payload(usuario)}, status=200)


@csrf_exempt
def admin_user_role_view(request, user_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    new_role = (payload.get("rol") or "").strip().lower()
    if new_role not in {"paciente", "profesional", "administrador"}:
        return JsonResponse({"detail": "Rol invalido"}, status=400)

    try:
        usuario = Usuarios.objects.get(id=user_id)
    except Usuarios.DoesNotExist:
        return JsonResponse({"detail": "Usuario no encontrado"}, status=404)

    usuario.rol = new_role
    usuario.save(update_fields=["rol"])

    if new_role == "administrador":
        Administradores.objects.get_or_create(
            usuario=usuario,
            defaults={
                "perm_usuarios": True,
                "perm_cuestionarios": True,
                "perm_citas": True,
            },
        )

    return JsonResponse({"detail": "Rol actualizado", "rol": usuario.rol}, status=200)


@csrf_exempt
def admin_user_status_view(request, user_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    if "activo" not in payload:
        return JsonResponse({"detail": "El campo 'activo' es obligatorio"}, status=400)

    try:
        usuario = Usuarios.objects.get(id=user_id)
    except Usuarios.DoesNotExist:
        return JsonResponse({"detail": "Usuario no encontrado"}, status=404)

    usuario.activo = bool(payload.get("activo"))
    usuario.save(update_fields=["activo"])
    return JsonResponse({"detail": "Estado actualizado", "activo": usuario.activo}, status=200)


@csrf_exempt
def admin_permissions_view(request, user_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _require_admin(request)
    if error_response:
        return error_response

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    try:
        usuario = Usuarios.objects.get(id=user_id)
    except Usuarios.DoesNotExist:
        return JsonResponse({"detail": "Usuario no encontrado"}, status=404)

    if usuario.rol != "administrador":
        return JsonResponse({"detail": "El usuario no es administrador"}, status=400)

    admin, _ = Administradores.objects.get_or_create(
        usuario=usuario,
        defaults={
            "perm_usuarios": True,
            "perm_cuestionarios": True,
            "perm_citas": True,
        },
    )
    admin.perm_usuarios = bool(payload.get("perm_usuarios", admin.perm_usuarios))
    admin.perm_cuestionarios = bool(payload.get("perm_cuestionarios", admin.perm_cuestionarios))
    admin.perm_citas = bool(payload.get("perm_citas", admin.perm_citas))
    admin.save(update_fields=["perm_usuarios", "perm_cuestionarios", "perm_citas"])

    return JsonResponse(
        {
            "detail": "Permisos actualizados",
            "permisos": {
                "perm_usuarios": admin.perm_usuarios,
                "perm_cuestionarios": admin.perm_cuestionarios,
                "perm_citas": admin.perm_citas,
            },
        },
        status=200,
    )


def professionals_view(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    _, error_response = _get_authenticated_user(request)
    if error_response:
        return error_response

    profesionales = list(
        Profesionales.objects.select_related("usuario")
        .all()
        .values("id", "especialidad", "usuario__nombre", "usuario__email")
    )
    mapped = [
        {
            "id": p["id"],
            "nombre": p["usuario__nombre"],
            "email": p["usuario__email"],
            "especialidad": p["especialidad"],
        }
        for p in profesionales
    ]
    return JsonResponse({"profesionales": mapped}, status=200)


@csrf_exempt
def appointments_view(request):
    if request.method == "GET":
        usuario, error_response = _require_role(
            request, {"paciente", "profesional", "administrador"}
        )
        if error_response:
            return error_response

        citas_qs = Citas.objects.select_related(
            "paciente__usuario", "profesional__usuario"
        ).order_by("-fecha_hora")

        if usuario.rol == "paciente":
            paciente = Pacientes.objects.filter(usuario=usuario).first()
            if not paciente:
                return JsonResponse({"citas": []}, status=200)
            citas_qs = citas_qs.filter(paciente=paciente)
        elif usuario.rol == "profesional":
            profesional = Profesionales.objects.filter(usuario=usuario).first()
            if not profesional:
                return JsonResponse({"citas": []}, status=200)
            citas_qs = citas_qs.filter(profesional=profesional)
        if usuario.rol in {"paciente", "profesional"}:
            # Las canceladas no se muestran en paneles operativos.
            citas_qs = citas_qs.exclude(estado="cancelada")

        now = timezone.now()
        citas = []
        for c in citas_qs[:200]:
            estado_api = _normalizar_estado_cita(c.estado)
            # Si la cita ya paso y no esta cancelada, la mostramos como completada automaticamente.
            if estado_api in {"pendiente", "confirmada"} and c.fecha_hora < now:
                estado_api = "completada"
            citas.append(
                {
                    "id": c.id,
                    "fecha_hora": c.fecha_hora.isoformat(),
                    "estado": estado_api,
                    "paciente_id": c.paciente_id,
                    "profesional_id": c.profesional_id,
                    "duracion_min": c.duracion_min,
                    "paciente_nombre": c.paciente.usuario.nombre,
                    "profesional_nombre": c.profesional.usuario.nombre,
                }
            )
        return JsonResponse({"citas": citas}, status=200)

    if request.method == "POST":
        usuario, error_response = _require_role(request, {"paciente", "administrador"})
        if error_response:
            return error_response

        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        profesional_id = payload.get("profesional_id")
        fecha_hora_raw = payload.get("fecha_hora")

        if not profesional_id or not fecha_hora_raw:
            return JsonResponse(
                {"detail": "Los campos 'profesional_id' y 'fecha_hora' son obligatorios"},
                status=400,
            )

        try:
            profesional = Profesionales.objects.get(id=profesional_id)
        except Profesionales.DoesNotExist:
            return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

        try:
            fecha_hora = datetime.fromisoformat(str(fecha_hora_raw).replace("Z", "+00:00"))
        except ValueError:
            return JsonResponse({"detail": "Formato de fecha_hora invalido"}, status=400)

        if timezone.is_naive(fecha_hora):
            fecha_hora = timezone.make_aware(
                fecha_hora,
                timezone.get_current_timezone(),
            )

        if fecha_hora <= timezone.now():
            logger.warning(
                "reserva_rechazada_fecha_pasada",
                extra={"profesional_id": profesional_id, "fecha_hora": str(fecha_hora_raw)},
            )
            return JsonResponse(
                {"detail": "No se pueden crear citas en fecha pasada"},
                status=400,
            )

        antelacion_min, horizonte_dias, descanso_min, _ = _politicas_profesional(profesional)
        hoy = timezone.localdate()
        if fecha_hora.date() > hoy + timedelta(days=horizonte_dias):
            logger.warning(
                "reserva_rechazada_horizonte",
                extra={"profesional_id": profesional_id, "fecha_hora": fecha_hora.isoformat()},
            )
            return JsonResponse(
                {
                    "detail": "La fecha supera el horizonte maximo permitido para reservar",
                },
                status=400,
            )
        if fecha_hora < timezone.now() + timedelta(minutes=antelacion_min):
            logger.warning(
                "reserva_rechazada_antelacion",
                extra={"profesional_id": profesional_id, "fecha_hora": fecha_hora.isoformat()},
            )
            return JsonResponse(
                {
                    "detail": "No hay tiempo suficiente de antelacion para esta reserva",
                },
                status=400,
            )

        if usuario.rol == "paciente":
            paciente = Pacientes.objects.filter(usuario=usuario).first()
            if not paciente:
                return JsonResponse({"detail": "Paciente no encontrado"}, status=404)
        else:
            paciente_id = payload.get("paciente_id")
            if not paciente_id:
                return JsonResponse(
                    {"detail": "El campo 'paciente_id' es obligatorio para admin"},
                    status=400,
                )
            paciente = Pacientes.objects.filter(id=paciente_id).first()
            if not paciente:
                return JsonResponse({"detail": "Paciente no encontrado"}, status=404)

        available_slots = _generate_slots_for_day(profesional, fecha_hora.date())
        match_slot = None
        for slot in available_slots:
            cand = datetime.fromisoformat(slot["inicio"].replace("Z", "+00:00"))
            if timezone.is_naive(cand):
                cand = timezone.make_aware(cand, timezone.get_current_timezone())
            if cand == fecha_hora:
                match_slot = slot
                break
        if not match_slot:
            logger.warning(
                "reserva_rechazada_slot_inexistente",
                extra={"profesional_id": profesional_id, "fecha_hora": fecha_hora.isoformat()},
            )
            return JsonResponse(
                {"detail": "La fecha/hora no esta disponible en la agenda del profesional"},
                status=409,
            )

        duracion_min = int(match_slot["duracion_min"])
        fin_cita = fecha_hora + timedelta(minutes=duracion_min)

        ocupados_pac = _intervalos_ocupados_paciente(paciente, fecha_hora.date())
        if _solapa_con_ocupados(fecha_hora, fin_cita, ocupados_pac):
            logger.warning(
                "reserva_rechazada_solape_paciente",
                extra={"profesional_id": profesional_id, "paciente_id": paciente.id, "fecha_hora": fecha_hora.isoformat()},
            )
            return JsonResponse(
                {"detail": "Ese intervalo choca con otra cita tuya ese dia"},
                status=409,
            )

        # Bloqueo atomico: evita doble reserva por concurrencia.
        with transaction.atomic():
            margen_fin = fin_cita + timedelta(minutes=max(0, descanso_min))
            conflictos_prof = Citas.objects.select_for_update().filter(
                profesional=profesional,
                fecha_hora__lt=margen_fin,
                fecha_hora__gte=fecha_hora - timedelta(minutes=DURACION_MAXIMA_SESION + max(0, descanso_min)),
                estado__in=list(ESTADOS_CITA_OCUPAN_SLOT),
            )
            for conflicto in conflictos_prof:
                c_duracion = int(conflicto.duracion_min or 50)
                c_inicio = conflicto.fecha_hora
                if timezone.is_naive(c_inicio):
                    c_inicio = timezone.make_aware(c_inicio, timezone.get_current_timezone())
                c_fin = c_inicio + timedelta(minutes=c_duracion + max(0, descanso_min))
                if fecha_hora < c_fin and c_inicio < margen_fin:
                    logger.warning(
                        "reserva_rechazada_solape_profesional",
                        extra={"profesional_id": profesional_id, "fecha_hora": fecha_hora.isoformat()},
                    )
                    return JsonResponse(
                        {"detail": "Ese intervalo ya esta ocupado para el profesional"},
                        status=409,
                    )

            cita = Citas.objects.create(
                paciente=paciente,
                profesional=profesional,
                fecha_hora=fecha_hora,
                estado="pendiente",
                duracion_min=duracion_min,
            )
        logger.info(
            "reserva_creada",
            extra={"cita_id": cita.id, "profesional_id": profesional_id, "paciente_id": paciente.id},
        )
        return JsonResponse(
            {
                "id": cita.id,
                "estado": cita.estado,
                "fecha_hora": cita.fecha_hora.isoformat(),
            },
            status=201,
        )

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def appointment_status_view(request, appointment_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    usuario, error_response = _require_role(
        request, {"paciente", "profesional", "administrador"}
    )
    if error_response:
        return error_response

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

    nuevo_estado = _normalizar_estado_cita(payload.get("estado"))
    if nuevo_estado not in ESTADOS_CITA_DISPONIBLES:
        return JsonResponse({"detail": "Estado invalido"}, status=400)

    try:
        cita = Citas.objects.select_related("profesional__usuario", "paciente").get(
            id=appointment_id
        )
    except Citas.DoesNotExist:
        return JsonResponse({"detail": "Cita no encontrada"}, status=404)

    if usuario.rol == "profesional" and cita.profesional.usuario_id != usuario.id:
        return JsonResponse({"detail": "No puedes modificar esta cita"}, status=403)
    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente or cita.paciente_id != paciente.id:
            return JsonResponse({"detail": "No puedes modificar esta cita"}, status=403)
        if nuevo_estado != "cancelada":
            return JsonResponse(
                {"detail": "Un paciente solo puede cancelar su cita"},
                status=403,
            )

    cita.estado = _estado_cita_a_db(nuevo_estado)
    cita.save(update_fields=["estado"])
    if cita.estado in {"aceptada", "completada"}:
        _get_or_create_conversation_for_users(cita.paciente, cita.profesional)
    return JsonResponse({"detail": "Estado de cita actualizado", "estado": _normalizar_estado_cita(cita.estado)}, status=200)


@csrf_exempt
def professional_schedule_view(request):
    usuario, error_response = _require_role(request, {"profesional"})
    if error_response:
        return error_response

    profesional = Profesionales.objects.filter(usuario=usuario).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    if request.method == "GET":
        agenda_semanal = list(
            AgendaProfesional.objects.filter(profesional=profesional)
            .order_by("dia_semana")
            .values(
                "id",
                "dia_semana",
                "hora_inicio",
                "hora_fin",
                "duracion_min",
                "precio",
                "activo",
            )
        )
        for row in agenda_semanal:
            row["hora_inicio"] = row["hora_inicio"].strftime("%H:%M")
            row["hora_fin"] = row["hora_fin"].strftime("%H:%M")
            row["precio"] = float(row["precio"])
        agenda_fechas = list(
            DisponibilidadProfesionalFecha.objects.filter(profesional=profesional)
            .order_by("fecha", "hora_inicio")
            .values(
                "id",
                "fecha",
                "hora_inicio",
                "hora_fin",
                "duracion_min",
                "precio",
                "activo",
            )[:200]
        )
        for row in agenda_fechas:
            row["fecha"] = row["fecha"].isoformat()
            row["hora_inicio"] = row["hora_inicio"].strftime("%H:%M")
            row["hora_fin"] = row["hora_fin"].strftime("%H:%M")
            row["precio"] = float(row["precio"])

        antelacion_min, horizonte_dias, descanso_min, granularidad_min = _politicas_profesional(profesional)
        excepciones = list(
            ExcepcionAgendaFecha.objects.filter(profesional=profesional)
            .order_by("-fecha")
            .values("id", "fecha", "solo_excepcion")[:500]
        )
        for row in excepciones:
            row["fecha"] = row["fecha"].isoformat()

        return JsonResponse(
            {
                "agenda_semanal": agenda_semanal,
                "agenda_fechas": agenda_fechas,
                "excepciones_fecha": excepciones,
                "politicas": {
                    "antelacion_minima_minutos": antelacion_min,
                    "horizonte_maximo_dias": horizonte_dias,
                    "descanso_entre_citas_minutos": descanso_min,
                    "granularidad_minutos": granularidad_min,
                },
            },
            status=200,
        )

    if request.method == "PUT":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        bloques = payload.get("bloques")
        if not isinstance(bloques, list):
            return JsonResponse({"detail": "El campo 'bloques' debe ser una lista"}, status=400)

        for block in bloques:
            dia = block.get("dia_semana")
            if dia is None or int(dia) < 0 or int(dia) > 6:
                return JsonResponse({"detail": "Dia de semana invalido"}, status=400)
            if not block.get("hora_inicio") or not block.get("hora_fin"):
                return JsonResponse(
                    {"detail": "hora_inicio y hora_fin son obligatorios"},
                    status=400,
                )
            dm = int(block.get("duracion_min", 50))
            if dm < DURACION_MINIMA_SESION or dm > DURACION_MAXIMA_SESION:
                return JsonResponse(
                    {"detail": "duracion_min fuera del rango permitido"},
                    status=400,
                )
            hi = _parse_hora(block["hora_inicio"])
            hf = _parse_hora(block["hora_fin"])
            tramo_min = int((datetime.combine(datetime.today(), hf) - datetime.combine(datetime.today(), hi)).total_seconds() // 60)
            if tramo_min < dm:
                return JsonResponse(
                    {"detail": "Cada tramo debe durar al menos una sesion completa"},
                    status=400,
                )
            if float(block.get("precio", 0)) < 0:
                return JsonResponse({"detail": "El precio no puede ser negativo"}, status=400)

        dia_tramos = {}
        for block in bloques:
            dia = int(block["dia_semana"])
            dia_tramos.setdefault(dia, []).append(block)

        for dia, lista in dia_tramos.items():
            objs = [
                SimpleNamespace(hora_inicio=b["hora_inicio"], hora_fin=b["hora_fin"]) for b in lista
            ]
            err = _validar_solapes_tramos(objs)
            if err:
                return JsonResponse({"detail": err}, status=400)

        with transaction.atomic():
            AgendaProfesional.objects.filter(profesional=profesional).delete()
            for block in bloques:
                AgendaProfesional.objects.create(
                    profesional=profesional,
                    dia_semana=int(block["dia_semana"]),
                    hora_inicio=block["hora_inicio"],
                    hora_fin=block["hora_fin"],
                    duracion_min=int(block.get("duracion_min", 50)),
                    precio=block.get("precio", 0),
                    activo=bool(block.get("activo", True)),
                )

        return JsonResponse({"detail": "Agenda guardada correctamente"}, status=200)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def professional_date_availability_view(request):
    usuario, error_response = _require_role(request, {"profesional"})
    if error_response:
        return error_response

    profesional = Profesionales.objects.filter(usuario=usuario).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        fecha = (payload.get("fecha") or "").strip()
        hora_inicio_raw = (payload.get("hora_inicio") or "").strip()
        hora_fin_raw = (payload.get("hora_fin") or "").strip()
        duracion_min = int(payload.get("duracion_min") or 0)
        precio = payload.get("precio")
        activo = bool(payload.get("activo", True))
        solo_este_dia = payload.get("solo_este_dia")
        if solo_este_dia is not None:
            solo_este_dia = bool(solo_este_dia)

        if not fecha or not hora_inicio_raw or not hora_fin_raw or duracion_min <= 0 or precio is None:
            return JsonResponse({"detail": "Faltan campos obligatorios"}, status=400)

        if duracion_min < DURACION_MINIMA_SESION or duracion_min > DURACION_MAXIMA_SESION:
            return JsonResponse(
                {"detail": "duracion_min fuera del rango permitido"},
                status=400,
            )
        try:
            float(precio)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "Precio invalido"}, status=400)
        if float(precio) < 0:
            return JsonResponse({"detail": "El precio no puede ser negativo"}, status=400)

        try:
            fecha_obj = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            return JsonResponse({"detail": "Formato de fecha invalido"}, status=400)

        if fecha_obj < timezone.localdate():
            return JsonResponse(
                {"detail": "No se puede crear disponibilidad en fechas pasadas"},
                status=400,
            )

        try:
            hi = _parse_hora(hora_inicio_raw)
            hf = _parse_hora(hora_fin_raw)
        except ValueError:
            return JsonResponse({"detail": "Formato de hora invalido"}, status=400)

        if hf <= hi:
            return JsonResponse(
                {"detail": "hora_fin debe ser posterior a hora_inicio"},
                status=400,
            )
        tramo_min = int((datetime.combine(datetime.today(), hf) - datetime.combine(datetime.today(), hi)).total_seconds() // 60)
        if tramo_min < duracion_min:
            return JsonResponse(
                {"detail": "El tramo debe tener al menos la duracion de una sesion"},
                status=400,
            )

        tz = timezone.get_current_timezone()
        fin_tramo_dt = timezone.make_aware(datetime.combine(fecha_obj, hf), tz)
        if fecha_obj == timezone.localdate() and fin_tramo_dt <= timezone.now():
            return JsonResponse(
                {"detail": "Este tramo ya no es valido (todo el intervalo esta en el pasado)"},
                status=400,
            )

        simulados = _simular_bloques_dia_tramo_nuevo(
            profesional,
            fecha_obj,
            hi,
            hf,
            exclude_disp_id=None,
        )
        err = _validar_solapes_tramos(simulados)
        if err:
            return JsonResponse({"detail": err}, status=400)

        if solo_este_dia is not None:
            ExcepcionAgendaFecha.objects.update_or_create(
                profesional=profesional,
                fecha=fecha_obj,
                defaults={"solo_excepcion": solo_este_dia},
            )

        disponibilidad = DisponibilidadProfesionalFecha.objects.create(
            profesional=profesional,
            fecha=fecha_obj,
            hora_inicio=hi,
            hora_fin=hf,
            duracion_min=duracion_min,
            precio=precio,
            activo=activo,
        )
        return JsonResponse({"id": disponibilidad.id, "detail": "Disponibilidad creada"}, status=201)

    if request.method == "DELETE":
        disponibilidad_id = request.GET.get("id")
        if not disponibilidad_id:
            return JsonResponse({"detail": "Parametro id obligatorio"}, status=400)
        deleted, _ = DisponibilidadProfesionalFecha.objects.filter(
            id=disponibilidad_id,
            profesional=profesional,
        ).delete()
        if not deleted:
            return JsonResponse({"detail": "Disponibilidad no encontrada"}, status=404)
        return JsonResponse({"detail": "Disponibilidad eliminada"}, status=200)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


def professional_slots_view(request, profesional_id):
    _, error_response = _require_role(request, {"paciente", "administrador", "profesional"})
    if error_response:
        return error_response

    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    date_raw = (request.GET.get("date") or "").strip()
    if not date_raw:
        return JsonResponse({"detail": "Parametro 'date' obligatorio (YYYY-MM-DD)"}, status=400)

    try:
        date_obj = datetime.strptime(date_raw, "%Y-%m-%d").date()
    except ValueError:
        return JsonResponse({"detail": "Formato de fecha invalido"}, status=400)

    profesional = Profesionales.objects.filter(id=profesional_id).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    slots = _generate_slots_for_day(profesional, date_obj)
    antelacion_min, horizonte_dias, descanso_min, granularidad_min = _politicas_profesional(profesional)
    return JsonResponse(
        {
            "slots": slots,
            "politicas": {
                "antelacion_minima_minutos": antelacion_min,
                "horizonte_maximo_dias": horizonte_dias,
                "descanso_entre_citas_minutos": descanso_min,
                "granularidad_minutos": granularidad_min,
            },
        },
        status=200,
    )


def professional_next_slots_view(request, profesional_id):
    _, error_response = _require_role(request, {"paciente", "administrador", "profesional"})
    if error_response:
        return error_response
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    date_raw = (request.GET.get("from_date") or "").strip()
    try:
        from_date = datetime.strptime(date_raw, "%Y-%m-%d").date() if date_raw else timezone.localdate()
    except ValueError:
        return JsonResponse({"detail": "Formato de fecha invalido"}, status=400)

    profesional = Profesionales.objects.filter(id=profesional_id).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    slots = _proximos_slots_disponibles(profesional, from_date)
    return JsonResponse({"slots": slots}, status=200)


@csrf_exempt
def professional_agenda_politicas_view(request):
    usuario, error_response = _require_role(request, {"profesional"})
    if error_response:
        return error_response

    profesional = Profesionales.objects.filter(usuario=usuario).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    if request.method == "GET":
        antelacion_min, horizonte_dias, descanso_min, granularidad_min = _politicas_profesional(profesional)
        return JsonResponse(
            {
                "antelacion_minima_minutos": antelacion_min,
                "horizonte_maximo_dias": horizonte_dias,
                "descanso_entre_citas_minutos": descanso_min,
                "granularidad_minutos": granularidad_min,
            },
            status=200,
        )

    if request.method == "PUT":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        ant_raw = payload.get("antelacion_minima_minutos")
        hor_raw = payload.get("horizonte_maximo_dias")
        des_raw = payload.get("descanso_entre_citas_minutos")
        gra_raw = payload.get("granularidad_minutos")
        if ant_raw is None or hor_raw is None:
            return JsonResponse({"detail": "Faltan campos obligatorios"}, status=400)
        ant = int(ant_raw)
        hor = int(hor_raw)
        des = int(des_raw if des_raw is not None else DEFAULT_DESCANSO_ENTRE_CITAS_MINUTOS)
        gra = int(gra_raw if gra_raw is not None else DEFAULT_GRANULARIDAD_MINUTOS)
        if ant < 0 or ant > 24 * 60:
            return JsonResponse(
                {"detail": "antelacion_minima_minutos fuera de rango (0-1440)"},
                status=400,
            )
        if hor < 1 or hor > 365:
            return JsonResponse(
                {"detail": "horizonte_maximo_dias fuera de rango (1-365)"},
                status=400,
            )
        if des < 0 or des > 180:
            return JsonResponse(
                {"detail": "descanso_entre_citas_minutos fuera de rango (0-180)"},
                status=400,
            )
        if gra < GRANULARIDAD_MINIMA or gra > GRANULARIDAD_MAXIMA:
            return JsonResponse(
                {"detail": "granularidad_minutos fuera de rango (5-60)"},
                status=400,
            )

        ProfesionalAgendaPoliticas.objects.update_or_create(
            profesional=profesional,
            defaults={
                "antelacion_minima_minutos": ant,
                "horizonte_maximo_dias": hor,
                "descanso_entre_citas_minutos": des,
                "granularidad_minutos": gra,
            },
        )
        return JsonResponse(
            {
                "detail": "Politicas actualizadas",
                "antelacion_minima_minutos": ant,
                "horizonte_maximo_dias": hor,
                "descanso_entre_citas_minutos": des,
                "granularidad_minutos": gra,
            },
            status=200,
        )

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def professional_exception_day_view(request):
    usuario, error_response = _require_role(request, {"profesional"})
    if error_response:
        return error_response

    profesional = Profesionales.objects.filter(usuario=usuario).first()
    if not profesional:
        return JsonResponse({"detail": "Profesional no encontrado"}, status=404)

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        fecha = (payload.get("fecha") or "").strip()
        if not fecha:
            return JsonResponse({"detail": "El campo fecha es obligatorio"}, status=400)
        if payload.get("solo_excepcion") is None:
            return JsonResponse({"detail": "El campo solo_excepcion es obligatorio"}, status=400)

        try:
            fecha_obj = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            return JsonResponse({"detail": "Formato de fecha invalido"}, status=400)

        if fecha_obj < timezone.localdate():
            return JsonResponse(
                {"detail": "No se puede configurar excepciones en fechas pasadas"},
                status=400,
            )

        solo = bool(payload.get("solo_excepcion"))
        ExcepcionAgendaFecha.objects.update_or_create(
            profesional=profesional,
            fecha=fecha_obj,
            defaults={"solo_excepcion": solo},
        )
        return JsonResponse(
            {
                "detail": "Modo del dia actualizado",
                "fecha": fecha_obj.isoformat(),
                "solo_excepcion": solo,
            },
            status=200,
        )

    if request.method == "DELETE":
        fecha_raw = (request.GET.get("fecha") or "").strip()
        if not fecha_raw:
            return JsonResponse({"detail": "Parametro fecha obligatorio"}, status=400)
        try:
            fecha_obj = datetime.strptime(fecha_raw, "%Y-%m-%d").date()
        except ValueError:
            return JsonResponse({"detail": "Formato de fecha invalido"}, status=400)

        ExcepcionAgendaFecha.objects.filter(
            profesional=profesional,
            fecha=fecha_obj,
        ).delete()
        return JsonResponse({"detail": "Excepcion eliminada"}, status=200)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


def _get_or_create_conversation_for_users(paciente, profesional):
    conv = (
        Conversaciones.objects.filter(paciente=paciente, profesional=profesional)
        .order_by("-fecha_creacion")
        .first()
    )
    if conv:
        return conv
    return Conversaciones.objects.create(
        paciente=paciente,
        profesional=profesional,
        fecha_creacion=timezone.now(),
    )


def _sync_conversations_from_accepted_appointments(usuario):
    """
    Garantiza conversaciones para relaciones paciente-profesional con cita aceptada/completada.
    Esto permite que ambos se vean automaticamente en el chat tras aceptar una cita.
    """
    # En BD usamos "aceptada" (la API expone "confirmada" como alias).
    estados_validos = {"aceptada"}
    citas_qs = Citas.objects.select_related("paciente", "profesional").filter(
        estado__in=estados_validos
    )
    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente:
            return
        citas_qs = citas_qs.filter(paciente=paciente)
    elif usuario.rol == "profesional":
        profesional = Profesionales.objects.filter(usuario=usuario).first()
        if not profesional:
            return
        citas_qs = citas_qs.filter(profesional=profesional)

    pairs = set()
    for c in citas_qs.values("paciente_id", "profesional_id").distinct():
        paciente_id = c.get("paciente_id")
        profesional_id = c.get("profesional_id")
        if paciente_id and profesional_id:
            pairs.add((int(paciente_id), int(profesional_id)))

    if not pairs:
        return

    pacientes = {p.id: p for p in Pacientes.objects.filter(id__in=[pid for pid, _ in pairs])}
    profesionales = {
        p.id: p for p in Profesionales.objects.filter(id__in=[prid for _, prid in pairs])
    }
    for paciente_id, profesional_id in pairs:
        paciente = pacientes.get(paciente_id)
        profesional = profesionales.get(profesional_id)
        if not paciente or not profesional:
            continue
        _get_or_create_conversation_for_users(paciente, profesional)


@csrf_exempt
def emotional_records_view(request):
    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response

    if request.method == "POST":
        if usuario.rol != "paciente":
            return JsonResponse({"detail": "Solo pacientes pueden registrar emociones"}, status=403)
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente:
            return JsonResponse({"detail": "Paciente no encontrado"}, status=404)
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
        emocion = (payload.get("emocion") or "").strip().lower()
        intensidad = int(payload.get("intensidad") or 0)
        nota = (payload.get("nota") or "").strip()
        if not emocion or intensidad < 1 or intensidad > 10:
            return JsonResponse({"detail": "emocion e intensidad (1-10) son obligatorios"}, status=400)
        rec = RegistrosEmocionales.objects.create(
            paciente=paciente,
            fecha=timezone.now(),
            emocion=emocion,
            intensidad=intensidad,
            nota=nota,
        )
        return JsonResponse({"id": rec.id, "detail": "Registro emocional creado"}, status=201)

    if request.method == "DELETE":
        if usuario.rol != "paciente":
            return JsonResponse({"detail": "Solo pacientes pueden eliminar sus registros"}, status=403)
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente:
            return JsonResponse({"detail": "Paciente no encontrado"}, status=404)
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
        record_id = payload.get("id")
        if not record_id:
            return JsonResponse({"detail": "Campo 'id' obligatorio"}, status=400)
        deleted, _ = RegistrosEmocionales.objects.filter(id=record_id, paciente=paciente).delete()
        if not deleted:
            return JsonResponse({"detail": "Registro no encontrado"}, status=404)
        return JsonResponse({"detail": "Registro eliminado"}, status=200)

    if request.method == "GET":
        paciente = None
        if usuario.rol == "paciente":
            paciente = Pacientes.objects.filter(usuario=usuario).first()
        else:
            paciente_id = request.GET.get("paciente_id")
            if not paciente_id:
                return JsonResponse({"detail": "Parametro paciente_id obligatorio"}, status=400)
            paciente = Pacientes.objects.filter(id=paciente_id).first()
        if not paciente:
            return JsonResponse({"registros": []}, status=200)
        rows = list(
            RegistrosEmocionales.objects.filter(paciente=paciente)
            .order_by("-fecha")
            .values("id", "fecha", "emocion", "intensidad", "nota")[:120]
        )
        for row in rows:
            row["fecha"] = row["fecha"].isoformat()
        return JsonResponse({"registros": rows}, status=200)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


def emotional_trend_view(request):
    usuario, error_response = _require_role(request, {"profesional", "administrador", "paciente"})
    if error_response:
        return error_response
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)

    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).first()
    else:
        paciente_id = request.GET.get("paciente_id")
        if not paciente_id:
            return JsonResponse({"detail": "Parametro paciente_id obligatorio"}, status=400)
        paciente = Pacientes.objects.filter(id=paciente_id).first()
    if not paciente:
        return JsonResponse({"promedio_intensidad": 0, "total": 0, "emociones": []}, status=200)

    rows = list(
        RegistrosEmocionales.objects.filter(paciente=paciente)
        .order_by("-fecha")
        .values("fecha", "emocion", "intensidad")[:30]
    )
    total = len(rows)
    promedio = (sum(int(r["intensidad"]) for r in rows) / total) if total else 0
    emociones = []
    for r in rows:
        emociones.append(
            {
                "fecha": r["fecha"].isoformat(),
                "emocion": r["emocion"],
                "intensidad": int(r["intensidad"]),
            }
        )
    return JsonResponse(
        {
            "promedio_intensidad": round(promedio, 2),
            "total": total,
            "emociones": emociones,
        },
        status=200,
    )


@csrf_exempt
def questionnaires_initial_view(request):
    usuario, error_response = _require_role(request, {"paciente"})
    if error_response:
        return error_response
    paciente = Pacientes.objects.filter(usuario=usuario).first()
    if not paciente:
        return JsonResponse({"detail": "Paciente no encontrado"}, status=404)

    cuestionario = Cuestionarios.objects.order_by("id").first()
    if not cuestionario:
        return JsonResponse({"detail": "No hay cuestionarios configurados"}, status=404)

    if request.method == "GET":
        preguntas = list(
            Preguntas.objects.filter(cuestionario=cuestionario)
            .order_by("orden")
            .values("id", "texto", "tipo", "orden")
        )
        respondidas_ids = list(
            Respuestas.objects.filter(paciente=paciente, pregunta__cuestionario=cuestionario)
            .values_list("pregunta_id", flat=True)
        )
        siguiente = next((p for p in preguntas if p["id"] not in respondidas_ids), None)
        return JsonResponse(
            {
                "cuestionario": {
                    "id": cuestionario.id,
                    "titulo": cuestionario.titulo,
                    "descripcion": cuestionario.descripcion,
                },
                "preguntas": preguntas,
                "respondidas_ids": respondidas_ids,
                "siguiente_pregunta": siguiente,
            },
            status=200,
        )

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
        respuestas = payload.get("respuestas")
        if not isinstance(respuestas, list) or not respuestas:
            return JsonResponse({"detail": "El campo respuestas debe ser una lista no vacia"}, status=400)
        guardadas = 0
        for item in respuestas:
            pregunta_id = item.get("pregunta_id")
            valor = str(item.get("valor") or "").strip()
            if not pregunta_id or not valor:
                continue
            if len(valor) > 500:
                return JsonResponse({"detail": "Cada respuesta debe tener como maximo 500 caracteres"}, status=400)
            pregunta = Preguntas.objects.filter(id=pregunta_id, cuestionario=cuestionario).first()
            if not pregunta:
                continue
            # Evita duplicados por pregunta/paciente: mantenemos solo la respuesta mas reciente.
            Respuestas.objects.filter(paciente=paciente, pregunta=pregunta).delete()
            Respuestas.objects.create(
                paciente=paciente,
                pregunta=pregunta,
                valor=valor,
                fecha=timezone.now(),
            )
            guardadas += 1
        if guardadas == 0:
            return JsonResponse({"detail": "No se pudieron guardar respuestas validas"}, status=400)
        respuestas_guardadas = list(
            Respuestas.objects.filter(paciente=paciente, pregunta__cuestionario=cuestionario)
            .select_related("pregunta")
            .order_by("pregunta__orden")
            .values("pregunta_id", "pregunta__orden", "valor")
        )
        puntuaciones = []
        for r in respuestas_guardadas:
            try:
                puntuaciones.append(int(str(r["valor"]).strip()))
            except (TypeError, ValueError):
                continue
        promedio = (sum(puntuaciones) / len(puntuaciones)) if puntuaciones else 0
        if promedio >= 7:
            nivel = "alto"
        elif promedio >= 4:
            nivel = "medio"
        else:
            nivel = "bajo"

        preguntas = list(
            Preguntas.objects.filter(cuestionario=cuestionario)
            .order_by("orden")
            .values("id", "texto", "tipo", "orden")
        )
        respondidas_ids = [r["pregunta_id"] for r in respuestas_guardadas]
        siguiente = next((p for p in preguntas if p["id"] not in respondidas_ids), None)
        return JsonResponse(
            {
                "detail": "Cuestionario guardado",
                "respuestas_guardadas": guardadas,
                "resultado": {
                    "promedio": round(promedio, 2),
                    "nivel_riesgo": nivel,
                },
                "siguiente_pregunta": siguiente,
                "completado": siguiente is None,
            },
            status=201,
        )

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def chat_conversations_view(request):
    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response

    if request.method == "GET":
        _sync_conversations_from_accepted_appointments(usuario)
        qs = Conversaciones.objects.select_related("paciente__usuario", "profesional__usuario").all()
        if usuario.rol == "paciente":
            paciente = Pacientes.objects.filter(usuario=usuario).first()
            qs = qs.filter(paciente=paciente) if paciente else qs.none()
        elif usuario.rol == "profesional":
            profesional = Profesionales.objects.filter(usuario=usuario).first()
            qs = qs.filter(profesional=profesional) if profesional else qs.none()
        rows = []
        for c in qs[:200]:
            last_msg = (
                Mensajes.objects.filter(conversacion=c)
                .order_by("-fecha_envio")
                .values("fecha_envio")
                .first()
            )
            ultimo_mov = last_msg["fecha_envio"] if last_msg and last_msg.get("fecha_envio") else c.fecha_creacion
            rows.append(
                {
                    "id": c.id,
                    "paciente_id": c.paciente_id,
                    "paciente_nombre": c.paciente.usuario.nombre,
                    "profesional_id": c.profesional_id,
                    "profesional_nombre": c.profesional.usuario.nombre,
                    "fecha_creacion": c.fecha_creacion.isoformat(),
                    "ultimo_movimiento": ultimo_mov.isoformat(),
                }
            )
        rows.sort(key=lambda r: r.get("ultimo_movimiento", ""), reverse=True)
        rows = rows[:100]
        return JsonResponse({"conversaciones": rows}, status=200)

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)

        if usuario.rol == "paciente":
            paciente = Pacientes.objects.filter(usuario=usuario).first()
            profesional = Profesionales.objects.filter(id=payload.get("profesional_id")).first()
        elif usuario.rol == "profesional":
            profesional = Profesionales.objects.filter(usuario=usuario).first()
            paciente = Pacientes.objects.filter(id=payload.get("paciente_id")).first()
        else:
            paciente = Pacientes.objects.filter(id=payload.get("paciente_id")).first()
            profesional = Profesionales.objects.filter(id=payload.get("profesional_id")).first()

        if not paciente or not profesional:
            return JsonResponse({"detail": "paciente/profesional invalidos"}, status=400)
        conv = _get_or_create_conversation_for_users(paciente, profesional)
        return JsonResponse({"id": conv.id, "detail": "Conversacion lista"}, status=201)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def chat_messages_view(request, conversation_id):
    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response
    conv = Conversaciones.objects.filter(id=conversation_id).first()
    if not conv:
        return JsonResponse({"detail": "Conversacion no encontrada"}, status=404)

    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente or conv.paciente_id != paciente.id:
            return JsonResponse({"detail": "No puedes acceder a esta conversacion"}, status=403)
    if usuario.rol == "profesional":
        profesional = Profesionales.objects.filter(usuario=usuario).first()
        if not profesional or conv.profesional_id != profesional.id:
            return JsonResponse({"detail": "No puedes acceder a esta conversacion"}, status=403)

    if request.method == "GET":
        rows = list(
            Mensajes.objects.filter(conversacion=conv)
            .order_by("fecha_envio")
            .values("id", "emisor", "contenido", "fecha_envio")[:300]
        )
        for row in rows:
            row["fecha_envio"] = row["fecha_envio"].isoformat()
        return JsonResponse({"mensajes": rows}, status=200)

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
        contenido = (payload.get("contenido") or "").strip()
        if not contenido:
            return JsonResponse({"detail": "contenido es obligatorio"}, status=400)
        if len(contenido) > 2000:
            return JsonResponse({"detail": "contenido demasiado largo (maximo 2000 caracteres)"}, status=400)
        if usuario.rol == "paciente":
            emisor = "paciente"
        elif usuario.rol == "profesional":
            emisor = "profesional"
        else:
            emisor = (payload.get("emisor") or "admin").strip().lower()
        msg = Mensajes.objects.create(
            conversacion=conv,
            emisor=emisor,
            contenido=contenido,
            fecha_envio=timezone.now(),
        )
        return JsonResponse({"id": msg.id, "detail": "Mensaje enviado"}, status=201)

    return JsonResponse({"detail": "Metodo no permitido"}, status=405)


@csrf_exempt
def chatbot_status_view(request):
    from .chatbot import chatbot_ia_disponible

    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response
    if request.method != "GET":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)
    status = chatbot_ia_disponible()
    ia_activa = status["ollama"] or status["groq"] or status["gemini"]
    return JsonResponse({"ia_activa": ia_activa, "proveedores": status}, status=200)


@csrf_exempt
def chatbot_reply_view(request):
    from .chatbot import chatbot_ia_disponible, generate_chatbot_reply

    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response
    if request.method != "POST":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
    text = (payload.get("mensaje") or "").strip()
    if not text:
        return JsonResponse({"detail": "mensaje es obligatorio"}, status=400)
    historial_raw = payload.get("historial")
    historial = None
    if isinstance(historial_raw, list):
        historial = []
        for item in historial_raw[:16]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "user")).strip().lower()
            content = str(item.get("content", "")).strip()[:2000]
            if role in ("user", "assistant") and content:
                historial.append({"role": role, "content": content})
    reply, fuente = generate_chatbot_reply(text, historial)
    return JsonResponse(
        {"respuesta": reply, "fuente": fuente, "ia_activa": fuente in ("ollama", "groq", "gemini")},
        status=200,
    )


@csrf_exempt
def appointment_reschedule_view(request, appointment_id):
    usuario, error_response = _require_role(request, {"paciente", "profesional", "administrador"})
    if error_response:
        return error_response
    if request.method != "PATCH":
        return JsonResponse({"detail": "Metodo no permitido"}, status=405)
    try:
        cita = Citas.objects.select_related("profesional", "paciente").get(id=appointment_id)
    except Citas.DoesNotExist:
        return JsonResponse({"detail": "Cita no encontrada"}, status=404)

    if usuario.rol == "paciente":
        paciente = Pacientes.objects.filter(usuario=usuario).first()
        if not paciente or cita.paciente_id != paciente.id:
            return JsonResponse({"detail": "No puedes reprogramar esta cita"}, status=403)
    if usuario.rol == "profesional":
        profesional = Profesionales.objects.filter(usuario=usuario).first()
        if not profesional or cita.profesional_id != profesional.id:
            return JsonResponse({"detail": "No puedes reprogramar esta cita"}, status=403)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Cuerpo JSON invalido"}, status=400)
    fecha_hora_raw = payload.get("fecha_hora")
    if not fecha_hora_raw:
        return JsonResponse({"detail": "fecha_hora es obligatorio"}, status=400)
    try:
        new_dt = datetime.fromisoformat(str(fecha_hora_raw).replace("Z", "+00:00"))
    except ValueError:
        return JsonResponse({"detail": "Formato de fecha_hora invalido"}, status=400)
    if timezone.is_naive(new_dt):
        new_dt = timezone.make_aware(new_dt, timezone.get_current_timezone())
    if new_dt <= timezone.now():
        return JsonResponse({"detail": "No se puede reprogramar a fecha pasada"}, status=400)
    if cita.fecha_hora and abs((new_dt - cita.fecha_hora).total_seconds()) < 60:
        return JsonResponse({"detail": "La cita ya esta en ese horario"}, status=400)

    profesional = cita.profesional
    slots = _generate_slots_for_day(profesional, new_dt.date())
    slot = None
    for s in slots:
        s_inicio = datetime.fromisoformat(str(s["inicio"]).replace("Z", "+00:00"))
        if timezone.is_naive(s_inicio):
            s_inicio = timezone.make_aware(s_inicio, timezone.get_current_timezone())
        if s_inicio == new_dt:
            slot = s
            break
    if not slot:
        return JsonResponse({"detail": "La nueva fecha no esta disponible"}, status=409)

    duracion_min = int(slot["duracion_min"])
    fin_cita = new_dt + timedelta(minutes=duracion_min)
    conflictos_paciente = Citas.objects.filter(
        paciente=cita.paciente,
        estado__in=list(ESTADOS_CITA_OCUPAN_SLOT),
    ).exclude(id=cita.id)
    for conflicto in conflictos_paciente:
        c_inicio = conflicto.fecha_hora
        if c_inicio is None:
            continue
        if timezone.is_naive(c_inicio):
            c_inicio = timezone.make_aware(c_inicio, timezone.get_current_timezone())
        c_fin = c_inicio + timedelta(minutes=int(conflicto.duracion_min or 50))
        if new_dt < c_fin and c_inicio < fin_cita:
            return JsonResponse({"detail": "Ese intervalo choca con otra cita del paciente"}, status=409)

    cita.fecha_hora = new_dt
    cita.duracion_min = duracion_min
    cita.estado = "pendiente"
    cita.save(update_fields=["fecha_hora", "duracion_min", "estado"])
    return JsonResponse(
        {"detail": "Cita reprogramada", "fecha_hora": cita.fecha_hora.isoformat(), "estado": cita.estado},
        status=200,
    )
