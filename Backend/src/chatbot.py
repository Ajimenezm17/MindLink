"""Asistente de bienestar: Ollama (local), Gemini, Groq o reglas mejoradas."""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Eres un asistente de apoyo emocional conversacional, como un chat amable y reflexivo.
Responde SIEMPRE en castellano de Espana, con tono cercano, empatico y natural.

Tu rol:
- Escuchar, validar emociones y ayudar a ordenar ideas.
- Dar orientacion general sobre bienestar emocional, relaciones, estres, animo, etc.
- Si preguntan por tipo de profesional, explica con claridad psicologo vs psiquiatra vs otros, sin alarmar.

Limites (muy importantes):
- NO eres psicologo ni medico. No diagnostiques ni recetes.
- NO digas que puedes reservar citas, registrar emociones ni usar funciones de la app: no las tienes.
- NO menciones "calendario emocional" ni "reservar en MindLink" salvo que el usuario pregunte explicitamente por la app.
- Si hay riesgo de suicidio, autolesion o violencia, prioriza recursos de ayuda en Espana (024, 016, 112).

Estilo:
- Responde de forma directa a lo que preguntan, como en una conversacion con ChatGPT.
- 2-4 parrafos cortos. Puedes hacer una pregunta abierta al final para seguir la charla.
- No repitas siempre la misma frase de cierre."""

CRISIS_PATTERN = re.compile(
    r"\b(suicid|matarme|morirme|no quiero vivir|autolesion|autolesi[oó]n|cortarme|"
    r"hacerme daño|acabar con todo|quitarme la vida)\b",
    re.IGNORECASE,
)

CRISIS_REPLY = (
    "Gracias por contarlo; sé que no es fácil. Si tienes pensamientos de hacerte daño o sientes "
    "que no puedes garantizar tu seguridad, contacta ahora con el **024** (atención a la conducta suicida, 24 h), "
    "el **112** en emergencia o acude a urgencias. También puedes llamar al **016** si hay violencia. "
    "¿Hay alguien de confianza cerca con quien puedas hablar hoy?"
)


def _rules_reply(text: str, history: list[dict[str, str]] | None = None) -> str:
    t = text.lower()
    if CRISIS_PATTERN.search(t):
        return CRISIS_REPLY

    if re.search(r"\b(especialist|psicolog|psiquiatr|terapeut|a quien ir|a quién ir|"
                 r"que profesional|qué profesional|que tipo de|qué tipo de|"
                 r"con quien hablar|con quién hablar)\b", t):
        if re.search(r"\bangust|\bpanico|pánico|ansiedad", t):
            return (
                "Si lo que sientes es **angustia** o mucha **ansiedad**, lo habitual es empezar con un "
                "**psicólogo** (sanitario o clínico): puede ayudarte a entender qué la dispara, "
                "manejar síntomas y afrontar el día a día con técnicas concretas.\n\n"
                "Un **psiquiatra** suele entrar más en juego si los síntomas son muy intensos, "
                "llevan mucho tiempo o hay sospecha de que un tratamiento médico pueda ayudar; "
                "muchas veces trabajan en equipo con el psicólogo.\n\n"
                "No hace falta que tengas claro el diagnóstico para pedir la primera cita: "
                "cuenta lo que te pasa (angustia, cuándo aparece, qué lo empeora) y el profesional "
                "te orientará. ¿La angustia te llega en momentos concretos o está casi todo el día?"
            )
        return (
            "Depende de lo que te esté pasando:\n\n"
            "• **Psicólogo/a**: problemas emocionales, ansiedad, tristeza, estrés, duelos, "
            "autoestima, relaciones… Es suele ser el primer paso.\n"
            "• **Psiquiatra/a**: valoración médica; puede recetar medicación si hace falta, "
            "a menudo junto con terapia psicológica.\n"
            "• **Psicólogo infantil/juvenil** si el problema es de un menor.\n\n"
            "Si me cuentas un poco qué sientes o desde cuándo, puedo orientarte mejor "
            "sin sustituir a un profesional. ¿Qué es lo que más te preocupa ahora?"
        )

    if re.search(r"\bangust", t):
        return (
            "La angustia es muy incómoda, pero tiene sentido que quieras entenderla. "
            "A veces el cuerpo reacciona como si hubiera peligro aunque no lo haya. "
            "Prueba anclarte: nombra 5 cosas que ves, 4 que tocas, 3 que oyes; "
            "respira lento por la nariz y suelta el aire largo por la boca.\n\n"
            "Si se repite o te limita, un psicólogo puede ayudarte a identificar disparadores "
            "y herramientas más allá del momento agudo. "
            "¿Suele aparecer con algo concreto (trabajo, relaciones, salud) o sin avisar?"
        )

    if re.search(r"\bansiedad|ansios|nervios|preocup", t):
        return (
            "La ansiedad muchas veces es el cuerpo en modo alerta. No significa que estés "
            "\"fallando\". Puedes probar 4-7-8: inhala 4 s, mantén 7, exhala 8, varias veces.\n\n"
            "Observa si hay pensamientos del tipo \"¿y si pasa lo peor?\" — nombrarlos ya reduce "
            "un poco su fuerza. Si te cuesta dormir o concentrarte por esto, merece la pena "
            "hablarlo con un psicólogo. ¿Qué situaciones te la disparan más?"
        )

    if re.search(r"\btriste|deprim|bajo|vacío|vacio|sin ganas|apatia|apatía", t):
        return (
            "Siento que estés así. La tristeza persistente puede agotar mucho; "
            "no tienes que llevarlo solo/a.\n\n"
            "Pequeños pasos ayudan: una ducha, salir 10 minutos, hablar con alguien de confianza. "
            "Si llevas semanas así o te cuesta funcionar, un psicólogo (y en algunos casos "
            "valoración psiquiátrica) puede marcar la diferencia. "
            "¿Desde cuándo te notas peor y qué ha cambiado en tu vida últimamente?"
        )

    if re.search(r"\bestres|estrés|agobi|satur|burnout|trabajo", t):
        return (
            "El estrés y el agobio suelen aparecer cuando pides al cuerpo más de lo que puede "
            "sostener. ¿Puedes identificar qué está en tu zona de control esta semana y qué no?\n\n"
            "A veces ayuda bajar el listado a 1-2 prioridades reales y delegar o posponer el resto. "
            "Si el trabajo es el núcleo, un psicólogo puede trabajar límites y forma de recuperarte. "
            "¿Es algo puntual o llevas meses así?"
        )

    if re.search(r"\binsomnio|dormir|sueño|sueno|despert", t):
        return (
            "Dormir mal desgasta el ánimo y la paciencia. Intenta horario fijo, luz tenue 1 h antes "
            "de acostarte y nada de móvil en la cama si puedes.\n\n"
            "Si la mente no para (rumiación, angustia nocturna), conviene tratarlo en terapia. "
            "¿Te cuesta conciliar el sueño o te despiertas a mitad de noche?"
        )

    if re.search(r"\brelacion|pareja|familia|solo|soledad|conflict", t):
        return (
            "Las relaciones pueden ser una gran fuente de bienestar o de dolor. "
            "Lo que sientes es válido.\n\n"
            "¿Te ayudaría hablar de qué ha pasado en la relación o de cómo te hablas a ti mismo/a "
            "cuando estás solo/a? A veces el foco está en el otro y otras en lo que necesitas tú."
        )

    if re.search(r"\bhola|buenas|hey", t) and len(t) < 40:
        return (
            "Hola. Estoy aquí para charlar sobre cómo te sientes o dudas sobre bienestar emocional. "
            "¿Qué te gustaría contar hoy?"
        )

    if re.search(r"\bgracias|thank", t) and len(t) < 60:
        return (
            "De nada. Cuando quieras seguimos hablando. ¿Hay algo más en lo que pueda ayudarte ahora?"
        )

    # Respuesta por defecto: conversacional, sin CTAs de la app
    return (
        "Te escucho. Cuéntame un poco más: ¿qué te preocupa, desde cuándo lo notas "
        "y cómo te afecta en el día a día? Así puedo orientarte mejor "
        "(sin sustituir a un profesional de la salud mental)."
    )


def _http_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout: int = 45,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    base_headers = {
        "Content-Type": "application/json",
        "User-Agent": "MindLink-Chatbot/1.0",
        **(headers or {}),
    }
    req = urllib.request.Request(
        url,
        data=data,
        headers=base_headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _ollama_base_urls() -> list[str]:
    configured = os.environ.get("OLLAMA_BASE_URL", "").strip()
    candidates = [
        configured,
        "http://host.docker.internal:11434",
        "http://127.0.0.1:11434",
        "http://localhost:11434",
    ]
    seen: set[str] = set()
    out: list[str] = []
    for url in candidates:
        if not url:
            continue
        base = url.rstrip("/")
        if base not in seen:
            seen.add(base)
            out.append(base)
    return out


def _build_messages(user_message: str, history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in (history or [])[-10:]:
        role = item.get("role", "user")
        content = (item.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


def _reply_ollama(user_message: str, history: list[dict[str, str]] | None) -> str | None:
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    timeout = int(os.environ.get("OLLAMA_TIMEOUT_SEC", "25"))
    payload = {"model": model, "messages": _build_messages(user_message, history), "stream": False}
    for base in _ollama_base_urls():
        try:
            body = _http_json(f"{base}/api/chat", payload, timeout=timeout)
            content = (body.get("message") or {}).get("content", "").strip()
            if content:
                logger.info("chatbot_ollama_ok base=%s", base)
                return content
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
            logger.warning("chatbot_ollama_error base=%s err=%s", base, exc)
    return None


def _reply_groq(user_message: str, history: list[dict[str, str]] | None) -> str | None:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
    try:
        body = _http_json(
            "https://api.groq.com/openai/v1/chat/completions",
            {"model": model, "messages": _build_messages(user_message, history), "temperature": 0.75},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=45,
        )
        choices = body.get("choices") or []
        if not choices:
            return None
        return (choices[0].get("message") or {}).get("content", "").strip() or None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        logger.warning("chatbot_groq_error: %s", exc)
        return None


def _reply_gemini(user_message: str, history: list[dict[str, str]] | None) -> str | None:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    contents = []
    for item in (history or [])[-10:]:
        role = item.get("role", "user")
        content = (item.get("content") or "").strip()
        if not content:
            continue
        gemini_role = "model" if role == "assistant" else "user"
        contents.append({"role": gemini_role, "parts": [{"text": content}]})
    contents.append({"role": "user", "parts": [{"text": user_message}]})
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    try:
        body = _http_json(
            url,
            {
                "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": contents,
                "generationConfig": {"temperature": 0.75, "maxOutputTokens": 768},
            },
            timeout=45,
        )
        candidates = body.get("candidates") or []
        if not candidates:
            return None
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        logger.warning("chatbot_gemini_error: %s", exc)
        return None


def chatbot_ia_disponible() -> dict[str, bool]:
    """Indica qué proveedores de IA están configurados o alcanzables."""
    ollama_ok = False
    for base in _ollama_base_urls():
        try:
            req = urllib.request.Request(
                f"{base}/api/tags",
                method="GET",
                headers={"User-Agent": "MindLink-Chatbot/1.0"},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    ollama_ok = True
                    break
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    return {
        "ollama": ollama_ok,
        "groq": bool(os.environ.get("GROQ_API_KEY", "").strip()),
        "gemini": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
    }


def generate_chatbot_reply(user_message: str, history: list[dict[str, str]] | None = None) -> tuple[str, str]:
    """
    Devuelve (respuesta, fuente).
    fuente: ollama | groq | gemini | reglas | reglas-crisis
    """
    text = (user_message or "").strip()
    if not text:
        return "Escribe un mensaje para poder ayudarte.", "reglas"
    if len(text) > 2000:
        return "El mensaje es demasiado largo (maximo 2000 caracteres).", "reglas"
    if CRISIS_PATTERN.search(text):
        return CRISIS_REPLY, "reglas-crisis"

    provider = os.environ.get("CHATBOT_PROVIDER", "auto").strip().lower()
    order: list[str]
    if provider == "ollama":
        order = ["ollama"]
    elif provider == "groq":
        order = ["groq"]
    elif provider == "gemini":
        order = ["gemini"]
    elif provider == "rules":
        order = []
    else:
        # Groq/Gemini primero si hay clave (mas fiable que Ollama sin instalar)
        order = []
        if os.environ.get("GROQ_API_KEY", "").strip():
            order.append("groq")
        if os.environ.get("GEMINI_API_KEY", "").strip():
            order.append("gemini")
        order.append("ollama")

    for name in order:
        if name == "ollama":
            reply = _reply_ollama(text, history)
            if reply:
                return reply, "ollama"
        elif name == "groq":
            reply = _reply_groq(text, history)
            if reply:
                return reply, "groq"
        elif name == "gemini":
            reply = _reply_gemini(text, history)
            if reply:
                return reply, "gemini"

    return _rules_reply(text, history), "reglas"
