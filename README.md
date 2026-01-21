🧠 Memoria I – MindLink

MindLink es una aplicación web orientada al seguimiento emocional y la comunicación entre pacientes y profesionales de la salud mental.
El sistema permite realizar una evaluación inicial adaptativa, registrar el estado emocional diario, facilitar la intervención mediante ejercicios y recomendaciones, y gestionar la comunicación y las citas entre pacientes y profesionales.

Este proyecto forma parte del Trabajo de Fin de Grado (TFG) y presenta una primera aproximación al diseño funcional, modelo de clases y modelo de datos del sistema.

🚀 Tecnologías utilizadas
Frontend

React

Tailwind CSS

JavaScript

Backend

Python

Flask

Base de Datos

MySQL

🔐 Funcionalidades principales
Funcionalidades generales

Registro y login de usuarios

Gestión de roles: paciente y profesional

Perfil de usuario

Control de sesiones y seguridad

Paciente

Cuestionario inicial adaptativo

Registro emocional diario

Acceso a historial emocional

Solicitud de citas

Comunicación mediante chat

Profesional

Panel de gestión de pacientes

Visualización del progreso emocional

Gestión y respuesta de mensajes

Gestión de citas

Funcionalidades Pro

Chat con bot y profesional

Calendario y agenda de citas

Gráficas emocionales

Recomendaciones personalizadas

📦 Módulos funcionales

Identidad y seguridad
Registro, autenticación, roles y sesiones.

Evaluación inicial
Cuestionario adaptativo y perfil emocional inicial.

Seguimiento
Registro emocional diario, histórico y gráficas (visión profesional).

Intervención
Ejercicios guiados y recomendaciones personalizadas.

Comunicación
Chat bot y chat entre paciente y profesional.

Citas
Solicitud, gestión y agenda de citas.

Panel profesional
Gestión de pacientes, seguimiento, mensajería y citas.

🧩 Modelo de clases (aproximación)

Las clases principales identificadas en el sistema son:

Usuario

Paciente (hereda de Usuario)

Profesional (hereda de Usuario)

Cuestionario

Pregunta

Respuesta

RegistroEmocional

Conversación

Mensaje

Cita

El modelo se ha diseñado para facilitar la escalabilidad del sistema y mantener una clara separación de responsabilidades entre las entidades.

🗄️ Modelo de Base de Datos (simplificado)

El modelo relacional se basa en las siguientes tablas:

usuarios

pacientes

profesionales

cuestionarios

preguntas

respuestas

registros_emocionales

conversaciones

mensajes

citas

Las relaciones están definidas mediante claves foráneas, permitiendo:

La asignación de múltiples pacientes a un profesional.

El registro histórico de respuestas y estados emocionales.

La comunicación estructurada mediante conversaciones y mensajes.

La gestión de citas entre pacientes y profesionales.

📊 Diagrama Entidad-Relación (ER)

Entidades principales

Usuario

Paciente

Profesional

Cuestionario

Pregunta

Respuesta

RegistroEmocional

Conversación

Mensaje

Cita

Relaciones clave

Usuario 1 — 1 Paciente

Usuario 1 — 1 Profesional

Profesional 1 — N Paciente

Cuestionario 1 — N Pregunta

Pregunta 1 — N Respuesta

Paciente 1 — N RegistroEmocional

Paciente 1 — N Cita

Profesional 1 — N Cita

Paciente 1 — N Conversación

Conversación 1 — N Mensaje

📌 Estado del proyecto

🔧 En desarrollo
Este repositorio corresponde a la fase inicial de análisis y diseño del sistema, incluyendo:

Definición funcional

Modelado de clases

Aproximación al modelo de datos
