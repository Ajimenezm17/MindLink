import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth.hashers import make_password
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from . import views
from .models import Usuarios


class AuthViewsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("src.views.Usuarios.objects.get")
    def test_login_ok_with_hashed_password(self, mock_get):
        usuario = SimpleNamespace(
            id=10,
            nombre="Carlos",
            email="carlos@mindlink.com",
            rol="paciente",
            telefono="600111222",
            dni="12345678A",
            ciudad_residencia="Madrid",
            activo=True,
            contrasena=make_password("clave1234"),
            save=Mock(),
        )
        mock_get.return_value = usuario

        request = self.factory.post(
            "/api/auth/login/",
            data=json.dumps({"email": "carlos@mindlink.com", "contrasena": "clave1234"}),
            content_type="application/json",
        )

        response = views.login_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["rol"], "paciente")
        self.assertIn("token", body)
        usuario.save.assert_not_called()

    @patch("src.views.Usuarios.objects.get")
    def test_login_upgrades_plaintext_password(self, mock_get):
        usuario = SimpleNamespace(
            id=11,
            nombre="Laura",
            email="laura@mindlink.com",
            rol="profesional",
            telefono="600333444",
            dni="87654321B",
            ciudad_residencia="Sevilla",
            activo=True,
            contrasena="texto_plano",
            save=Mock(),
        )
        mock_get.return_value = usuario

        request = self.factory.post(
            "/api/auth/login/",
            data=json.dumps({"email": "laura@mindlink.com", "contrasena": "texto_plano"}),
            content_type="application/json",
        )

        response = views.login_view(request)

        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(usuario.contrasena, "texto_plano")
        usuario.save.assert_called_once_with(update_fields=["contrasena"])

    @patch("src.views.Usuarios.objects.get")
    def test_login_invalid_credentials(self, mock_get):
        mock_get.side_effect = Usuarios.DoesNotExist

        request = self.factory.post(
            "/api/auth/login/",
            data=json.dumps({"email": "no@existe.com", "contrasena": "wrong"}),
            content_type="application/json",
        )

        response = views.login_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(body["detail"], "Credenciales invalidas")

    @patch("src.views.Pacientes.objects.create")
    @patch("src.views.Usuarios.objects.filter")
    @patch("src.views.Usuarios.objects.create")
    def test_register_ok(self, mock_create, mock_filter, mock_create_paciente):
        mock_filter.side_effect = [
            SimpleNamespace(exists=Mock(return_value=False)),
            SimpleNamespace(exists=Mock(return_value=False)),
        ]
        mock_create.return_value = SimpleNamespace(
            id=12,
            nombre="Ana",
            email="ana@mindlink.com",
            rol="paciente",
            telefono="600555666",
            dni="44556677C",
            ciudad_residencia="Valencia",
            activo=True,
        )

        request = self.factory.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "nombre": "Ana",
                    "email": "ana@mindlink.com",
                    "contrasena": "clave1234",
                    "rol": "paciente",
                    "telefono": "600555666",
                    "dni": "44556677C",
                    "ciudad_residencia": "Valencia",
                    "fecha_nacimiento": "1998-04-15",
                }
            ),
            content_type="application/json",
        )

        response = views.register_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(body["rol"], "paciente")
        self.assertIn("token", body)
        mock_create_paciente.assert_called_once()

    def test_register_admin_forbidden(self):
        request = self.factory.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "nombre": "Root",
                    "email": "root@mindlink.com",
                    "contrasena": "clave1234",
                    "rol": "administrador",
                    "telefono": "600999888",
                    "dni": "99887766D",
                    "ciudad_residencia": "Bilbao",
                }
            ),
            content_type="application/json",
        )

        response = views.register_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(body["detail"], "No esta permitido registrarse como administrador")

    @patch("src.views._get_authenticated_user")
    def test_admin_only_forbidden_when_not_admin(self, mock_auth):
        mock_auth.return_value = (
            SimpleNamespace(id=2, rol="paciente"),
            None,
        )
        request = self.factory.get(
            "/api/auth/admin-only/",
            HTTP_AUTHORIZATION="Bearer token",
        )

        response = views.admin_only_view(request)

        self.assertEqual(response.status_code, 403)

    @patch("src.views._get_authenticated_user")
    def test_me_returns_user_data(self, mock_auth):
        mock_auth.return_value = (
            SimpleNamespace(
                id=3,
                nombre="Eva",
                email="eva@mindlink.com",
                rol="administrador",
                telefono=None,
                dni=None,
                ciudad_residencia=None,
                activo=True,
            ),
            None,
        )
        request = self.factory.get(
            "/api/auth/me/",
            HTTP_AUTHORIZATION="Bearer token",
        )

        response = views.me_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["rol"], "administrador")

    @patch("src.views.RegistrosEmocionales.objects")
    @patch("src.views.Citas.objects")
    @patch("src.views.Usuarios.objects")
    @patch("src.views._require_admin")
    def test_admin_summary_returns_totals(
        self,
        mock_require_admin,
        mock_usuarios,
        mock_citas,
        mock_emociones,
    ):
        mock_require_admin.return_value = (SimpleNamespace(id=3, rol="administrador"), None)
        mock_usuarios.count.return_value = 10

        def _usuarios_filtered(count_val):
            qs = Mock()
            qs.count.return_value = count_val
            return qs

        mock_usuarios.filter.side_effect = [
            _usuarios_filtered(6),
            _usuarios_filtered(3),
            _usuarios_filtered(1),
            _usuarios_filtered(9),
            _usuarios_filtered(1),
        ]
        mock_usuarios.order_by.return_value.values.return_value = []
        mock_emociones.count.return_value = 42

        citas_chain = Mock()
        citas_chain.select_related.return_value = citas_chain
        citas_chain.filter.return_value = citas_chain
        citas_chain.exclude.return_value = citas_chain
        citas_chain.order_by.return_value = []
        citas_chain.count.return_value = 15
        mock_citas.select_related.return_value = citas_chain

        request = self.factory.get("/api/admin/resumen/", HTTP_AUTHORIZATION="Bearer token")
        response = views.admin_summary_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["total_usuarios"], 10)
        self.assertEqual(body["total_pacientes"], 6)
        self.assertEqual(body["total_profesionales"], 3)
        self.assertEqual(body["total_administradores"], 1)
        self.assertEqual(body["registros_emocionales"], 42)

    @patch("src.views._require_admin")
    @patch("src.views.Usuarios.objects")
    def test_admin_users_returns_list(self, mock_manager, mock_require_admin):
        mock_require_admin.return_value = (SimpleNamespace(id=3, rol="administrador"), None)
        fake_queryset = Mock()
        fake_queryset.order_by.return_value = fake_queryset
        fake_queryset.values.return_value = [
            {
                "id": 1,
                "nombre": "Alejandro",
                "email": "alejandro@mindlink.com",
                "rol": "administrador",
                "telefono": "600000000",
                "dni": "00000000A",
                "ciudad_residencia": "Madrid",
                "activo": True,
                "fecha_registro": "2026-04-21T00:00:00Z",
            }
        ]
        mock_manager.all.return_value = fake_queryset

        request = self.factory.get("/api/admin/usuarios/", HTTP_AUTHORIZATION="Bearer token")
        response = views.admin_users_view(request)
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(body["usuarios"]), 1)

    @patch("src.views._require_role")
    @patch("src.views.Profesionales.objects.get")
    def test_create_appointment_rejects_past_date(self, mock_prof_get, mock_require_role):
        mock_require_role.return_value = (
            SimpleNamespace(id=2, rol="paciente"),
            None,
        )
        mock_prof_get.return_value = SimpleNamespace(id=1)
        with patch("src.views.Pacientes.objects.filter") as mock_paciente_filter:
            mock_paciente_filter.return_value.first.return_value = SimpleNamespace(id=2)
            request = self.factory.post(
                "/api/citas/",
                data=json.dumps(
                    {
                        "profesional_id": 1,
                        "fecha_hora": (timezone.now() - timedelta(days=1)).isoformat(),
                    }
                ),
                content_type="application/json",
            )
            response = views.appointments_view(request)
            body = json.loads(response.content)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(body["detail"], "No se pueden crear citas en fecha pasada")

    @patch("src.views._politicas_profesional", return_value=(60, 90, 0, 5))
    @patch("src.views._require_role")
    @patch("src.views.Profesionales.objects.get")
    @patch("src.views._generate_slots_for_day")
    @patch("src.views.Citas.objects.select_for_update")
    @patch("src.views.transaction.atomic")
    def test_create_appointment_rejects_professional_overlap(
        self,
        mock_atomic,
        mock_select_for_update,
        mock_slots,
        mock_prof_get,
        mock_require_role,
        _mock_politicas,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_require_role.return_value = (
            SimpleNamespace(id=2, rol="paciente"),
            None,
        )
        mock_prof_get.return_value = SimpleNamespace(id=1)
        inicio = timezone.now() + timedelta(days=1)
        mock_slots.return_value = [
            {
                "inicio": inicio.isoformat(),
                "fin": (inicio + timedelta(minutes=50)).isoformat(),
                "duracion_min": 50,
                "precio": 40.0,
            }
        ]
        conflicto = SimpleNamespace(fecha_hora=inicio, duracion_min=50)
        mock_select_for_update.return_value.filter.return_value = [conflicto]
        with patch("src.views.Pacientes.objects.filter") as mock_paciente_filter:
            mock_paciente_filter.return_value.first.return_value = SimpleNamespace(id=2)
            with patch("src.views._intervalos_ocupados_paciente") as mock_pac_ocup:
                mock_pac_ocup.return_value = []
                request = self.factory.post(
                    "/api/citas/",
                    data=json.dumps(
                        {
                            "profesional_id": 1,
                            "fecha_hora": inicio.isoformat(),
                        }
                    ),
                    content_type="application/json",
                )
                response = views.appointments_view(request)
                self.assertEqual(response.status_code, 409)

    @patch("src.views._politicas_profesional", return_value=(60, 90, 15, 5))
    @patch("src.views._require_role")
    @patch("src.views.Profesionales.objects.get")
    @patch("src.views._generate_slots_for_day")
    @patch("src.views._intervalos_ocupados_paciente")
    @patch("src.views.Citas.objects.select_for_update")
    @patch("src.views.transaction.atomic")
    def test_create_appointment_rejects_concurrent_professional_overlap(
        self,
        mock_atomic,
        mock_select_for_update,
        mock_pac_ocup,
        mock_slots,
        mock_prof_get,
        mock_require_role,
        _mock_politicas,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_require_role.return_value = (SimpleNamespace(id=2, rol="paciente"), None)
        mock_prof_get.return_value = SimpleNamespace(id=1)
        inicio = timezone.now() + timedelta(days=1, hours=2)
        mock_slots.return_value = [
            {
                "inicio": inicio.isoformat(),
                "fin": (inicio + timedelta(minutes=50)).isoformat(),
                "duracion_min": 50,
                "precio": 40.0,
            }
        ]
        mock_pac_ocup.return_value = []
        conflicto = SimpleNamespace(fecha_hora=inicio, duracion_min=50)
        mock_select_for_update.return_value.filter.return_value = [conflicto]
        with patch("src.views.Pacientes.objects.filter") as mock_paciente_filter:
            mock_paciente_filter.return_value.first.return_value = SimpleNamespace(id=2)
            request = self.factory.post(
                "/api/citas/",
                data=json.dumps({"profesional_id": 1, "fecha_hora": inicio.isoformat()}),
                content_type="application/json",
            )
            response = views.appointments_view(request)
            self.assertEqual(response.status_code, 409)

    @patch("src.views._require_role")
    @patch("src.views.Citas.objects.select_related")
    @patch("src.views.Pacientes.objects.filter")
    def test_patient_can_only_cancel_own_appointment(self, mock_paciente_filter, mock_select_related, mock_require_role):
        mock_require_role.return_value = (
            SimpleNamespace(id=2, rol="paciente"),
            None,
        )
        mock_paciente_filter.return_value.first.return_value = SimpleNamespace(id=2)
        cita = SimpleNamespace(
            paciente_id=2,
            profesional=SimpleNamespace(usuario_id=5),
            estado="pendiente",
            save=Mock(),
        )
        mock_select_related.return_value.get.return_value = cita
        request = self.factory.patch(
            "/api/citas/1/estado/",
            data=json.dumps({"estado": "confirmada"}),
            content_type="application/json",
        )
        response = views.appointment_status_view(request, 1)
        self.assertEqual(response.status_code, 403)


class AgendaEngineTests(SimpleTestCase):
    @patch("src.views._intervalos_ocupados_profesional", return_value=[])
    @patch("src.views._bloques_agenda_para_fecha")
    @patch("src.views._politicas_profesional", return_value=(0, 30, 0, 5))
    def test_generate_slots_supports_split_schedule_and_mixed_duration(
        self,
        _mock_politicas,
        mock_bloques,
        _mock_ocupados,
    ):
        date_obj = timezone.localdate() + timedelta(days=1)
        bloque_manana = SimpleNamespace(
            id=1,
            hora_inicio="09:00",
            hora_fin="11:00",
            duracion_min=60,
            precio=50,
        )
        bloque_tarde = SimpleNamespace(
            id=2,
            hora_inicio="16:00",
            hora_fin="17:30",
            duracion_min=45,
            precio=45,
        )
        mock_bloques.return_value = [bloque_manana, bloque_tarde]

        slots = views._generate_slots_for_day(SimpleNamespace(id=9), date_obj)
        duraciones = [s["duracion_min"] for s in slots]
        self.assertIn(60, duraciones)
        self.assertIn(45, duraciones)
        self.assertTrue(all("source_block_id" in s for s in slots))

    @patch("src.views._intervalos_ocupados_profesional", return_value=[])
    @patch("src.views._bloques_agenda_para_fecha")
    @patch("src.views._politicas_profesional", return_value=(0, 30, 10, 15))
    def test_generate_slots_respects_granularity_and_break_policy(
        self,
        _mock_politicas,
        mock_bloques,
        _mock_ocupados,
    ):
        date_obj = timezone.localdate() + timedelta(days=1)
        mock_bloques.return_value = [
            SimpleNamespace(
                id=1,
                hora_inicio="09:00",
                hora_fin="10:00",
                duracion_min=30,
                precio=30,
            )
        ]
        slots = views._generate_slots_for_day(SimpleNamespace(id=7), date_obj)
        starts = [datetime.fromisoformat(str(s["inicio"])).minute for s in slots]
        self.assertTrue(all(m % 15 == 0 for m in starts))


class NextSlotsEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("src.views._require_role")
    @patch("src.views.Profesionales.objects.filter")
    @patch("src.views._proximos_slots_disponibles")
    def test_next_slots_returns_suggestions(
        self,
        mock_next_slots,
        mock_prof_filter,
        mock_require_role,
    ):
        mock_require_role.return_value = (SimpleNamespace(id=2, rol="paciente"), None)
        mock_prof_filter.return_value.first.return_value = SimpleNamespace(id=1)
        mock_next_slots.return_value = [
            {
                "inicio": (timezone.now() + timedelta(days=1)).isoformat(),
                "fin": (timezone.now() + timedelta(days=1, minutes=50)).isoformat(),
                "duracion_min": 50,
                "precio": 40.0,
            }
        ]
        request = self.factory.get("/api/profesionales/1/slots/proximos/?from_date=2026-04-30")
        response = views.professional_next_slots_view(request, 1)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(body["slots"]), 1)

    @patch("src.views._require_role")
    def test_next_slots_rejects_invalid_date(self, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=2, rol="paciente"), None)
        request = self.factory.get("/api/profesionales/1/slots/proximos/?from_date=bad-date")
        response = views.professional_next_slots_view(request, 1)
        self.assertEqual(response.status_code, 400)


class ChatbotServiceTests(SimpleTestCase):
    def test_rules_reply_ansiedad(self):
        import os
        from src.chatbot import generate_chatbot_reply

        os.environ["CHATBOT_PROVIDER"] = "rules"
        reply, fuente = generate_chatbot_reply("Tengo mucha ansiedad")
        self.assertEqual(fuente, "reglas")
        self.assertIn("ansiedad", reply.lower())

    def test_rules_reply_angustia_especialista(self):
        import os
        from src.chatbot import generate_chatbot_reply

        os.environ["CHATBOT_PROVIDER"] = "rules"
        reply, fuente = generate_chatbot_reply(
            "Siento angustia, a que tipo de especialista deberia acudir?"
        )
        self.assertEqual(fuente, "reglas")
        self.assertIn("psic", reply.lower())
        self.assertNotIn("calendario emocional", reply.lower())

    def test_crisis_uses_crisis_reply(self):
        import os
        from src.chatbot import generate_chatbot_reply

        os.environ["CHATBOT_PROVIDER"] = "rules"
        reply, fuente = generate_chatbot_reply("No quiero vivir mas")
        self.assertEqual(fuente, "reglas-crisis")
        self.assertIn("024", reply)


class ProfileEmotionsAndChatTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("src.views._get_authenticated_user")
    @patch("src.views.Pacientes.objects.filter")
    def test_profile_get_returns_payload(self, mock_pac_filter, mock_auth):
        user = SimpleNamespace(
            id=7,
            nombre="Ana",
            email="ana@mindlink.com",
            rol="paciente",
            telefono="600",
            dni="1A",
            ciudad_residencia="Madrid",
            activo=True,
            fecha_registro=timezone.now(),
        )
        mock_auth.return_value = (user, None)
        mock_pac_filter.return_value.values.return_value.first.return_value = {"telefono": "600"}
        request = self.factory.get("/api/auth/profile/", HTTP_AUTHORIZATION="Bearer token")
        response = views.profile_view(request)
        self.assertEqual(response.status_code, 200)

    @patch("src.views._get_authenticated_user")
    def test_profile_patch_invalid_json(self, mock_auth):
        mock_auth.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        request = self.factory.patch(
            "/api/auth/profile/",
            data="{bad json",
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.profile_view(request)
        self.assertEqual(response.status_code, 400)

    @patch("src.views._require_role")
    @patch("src.views.Pacientes.objects.filter")
    @patch("src.views.RegistrosEmocionales.objects.create")
    def test_emotional_record_create_ok(self, mock_create, mock_pac_filter, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_pac_filter.return_value.first.return_value = SimpleNamespace(id=9)
        mock_create.return_value = SimpleNamespace(id=30)
        request = self.factory.post(
            "/api/emociones/",
            data=json.dumps({"emocion": "feliz", "intensidad": 7}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.emotional_records_view(request)
        self.assertEqual(response.status_code, 201)

    @patch("src.views._require_role")
    def test_emotional_record_create_forbidden_for_professional(self, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=2, rol="profesional"), None)
        request = self.factory.post(
            "/api/emociones/",
            data=json.dumps({"emocion": "estres", "intensidad": 7}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.emotional_records_view(request)
        self.assertEqual(response.status_code, 403)

    @patch("src.views._require_role")
    @patch("src.views.Cuestionarios.objects.order_by")
    @patch("src.views.Pacientes.objects.filter")
    @patch("src.views.Preguntas.objects.filter")
    @patch("src.views.Respuestas.objects.filter")
    def test_questionnaire_get_ok(self, mock_respuestas_filter, mock_preguntas, mock_pac_filter, mock_q_order, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_pac_filter.return_value.first.return_value = SimpleNamespace(id=9)
        mock_q_order.return_value.first.return_value = SimpleNamespace(id=1, titulo="Inicial", descripcion="")
        mock_preguntas.return_value.order_by.return_value.values.return_value = []
        mock_respuestas_filter.return_value.values_list.return_value = []
        request = self.factory.get("/api/cuestionarios/inicial/", HTTP_AUTHORIZATION="Bearer token")
        response = views.questionnaires_initial_view(request)
        self.assertEqual(response.status_code, 200)

    @patch("src.views._require_role")
    @patch("src.views.Cuestionarios.objects.order_by")
    @patch("src.views.Pacientes.objects.filter")
    @patch("src.views.Preguntas.objects.filter")
    @patch("src.views.Respuestas.objects")
    def test_questionnaire_post_returns_risk_result(
        self,
        mock_respuestas,
        mock_preguntas,
        mock_pac_filter,
        mock_q_order,
        mock_require_role,
    ):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_pac_filter.return_value.first.return_value = SimpleNamespace(id=9)
        mock_q_order.return_value.first.return_value = SimpleNamespace(id=1, titulo="Inicial", descripcion="")
        mock_preguntas.return_value.filter.return_value.first.return_value = SimpleNamespace(id=1)
        mock_respuestas.filter.return_value.select_related.return_value.order_by.return_value.values.return_value = [
            {"pregunta_id": 1, "pregunta__orden": 1, "valor": "8"},
            {"pregunta_id": 2, "pregunta__orden": 2, "valor": "7"},
        ]
        mock_preguntas.return_value.order_by.return_value.values.return_value = [{"id": 3, "texto": "x", "tipo": "escala", "orden": 3}]
        request = self.factory.post(
            "/api/cuestionarios/inicial/",
            data=json.dumps({"respuestas": [{"pregunta_id": 1, "valor": "8"}]}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.questionnaires_initial_view(request)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(body["resultado"]["nivel_riesgo"], "alto")

    @patch("src.views._sync_conversations_from_accepted_appointments")
    @patch("src.views._require_role")
    @patch("src.views.Conversaciones.objects.select_related")
    @patch("src.views.Pacientes.objects.filter")
    def test_chat_conversations_get_for_patient(
        self,
        mock_pac_filter,
        mock_select_related,
        mock_require_role,
        _mock_sync_conversations,
    ):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_pac_filter.return_value.first.return_value = SimpleNamespace(id=8)
        mock_select_related.return_value.all.return_value.filter.return_value.order_by.return_value.__getitem__.return_value = []
        request = self.factory.get("/api/chat/conversaciones/", HTTP_AUTHORIZATION="Bearer token")
        response = views.chat_conversations_view(request)
        self.assertEqual(response.status_code, 200)

    @patch("src.chatbot.generate_chatbot_reply")
    @patch("src.views._require_role")
    def test_chatbot_reply_ok(self, mock_require_role, mock_generate):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_generate.return_value = ("Respuesta de prueba", "reglas")
        request = self.factory.post(
            "/api/chatbot/reply/",
            data=json.dumps({"mensaje": "Tengo ansiedad hoy"}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.chatbot_reply_view(request)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["respuesta"], "Respuesta de prueba")
        self.assertEqual(body["fuente"], "reglas")

    @patch("src.views._require_role")
    @patch("src.views.Conversaciones.objects.filter")
    def test_chat_message_rejects_too_long_content(self, mock_conv_filter, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="paciente"), None)
        mock_conv_filter.return_value.first.return_value = SimpleNamespace(id=1, paciente_id=8, profesional_id=3)
        with patch("src.views.Pacientes.objects.filter") as mock_pac_filter:
            mock_pac_filter.return_value.first.return_value = SimpleNamespace(id=8)
            request = self.factory.post(
                "/api/chat/conversaciones/1/mensajes/",
                data=json.dumps({"contenido": "x" * 2001}),
                content_type="application/json",
                HTTP_AUTHORIZATION="Bearer token",
            )
            response = views.chat_messages_view(request, 1)
            self.assertEqual(response.status_code, 400)

    @patch("src.views._require_role")
    @patch("src.views.Citas.objects.select_related")
    def test_reschedule_fails_if_appointment_not_found(self, mock_select_related, mock_require_role):
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="administrador"), None)
        mock_select_related.return_value.get.side_effect = views.Citas.DoesNotExist
        request = self.factory.patch(
            "/api/citas/123/reprogramar/",
            data=json.dumps({"fecha_hora": (timezone.now() + timedelta(days=2)).isoformat()}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.appointment_reschedule_view(request, 123)
        self.assertEqual(response.status_code, 404)

    @patch("src.views._require_role")
    @patch("src.views.Citas.objects.select_related")
    def test_reschedule_rejects_same_slot(self, mock_select_related, mock_require_role):
        now_plus = timezone.now() + timedelta(days=2)
        cita = SimpleNamespace(
            id=10,
            paciente_id=2,
            profesional_id=3,
            fecha_hora=now_plus,
            paciente=SimpleNamespace(id=2),
            profesional=SimpleNamespace(id=3),
        )
        mock_require_role.return_value = (SimpleNamespace(id=1, rol="administrador"), None)
        mock_select_related.return_value.get.return_value = cita
        request = self.factory.patch(
            "/api/citas/10/reprogramar/",
            data=json.dumps({"fecha_hora": now_plus.isoformat()}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer token",
        )
        response = views.appointment_reschedule_view(request, 10)
        self.assertEqual(response.status_code, 400)
