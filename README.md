# MindLink

**MindLink** es una aplicación web orientada al **seguimiento emocional** y la **comunicación entre pacientes y profesionales** de la salud mental (TFG).

El sistema permite:

- Evaluación inicial y cuestionarios
- Registro del estado emocional diario
- Gestión de citas y agenda del profesional
- Chat entre paciente y profesional
- Asistente de bienestar (chatbot)
- Panel de administración

## Estructura del repositorio

- `Backend/` — API **Django** + **PostgreSQL** (Docker)
- `frontend/` — SPA **Vite** + TypeScript + Tailwind

## Arranque local

### Backend

```bash
cd Backend
cp .env.example .env
docker compose up -d
```

API: http://localhost:8000/api/health/

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

## Variables sensibles

No subas `Backend/.env` al repositorio. Usa `.env.example` como plantilla (incluye `GROQ_API_KEY` si usas el asistente con Groq).

## Despliegue sugerido (gratis)

| Pieza | Servicio |
|-------|----------|
| Frontend | Vercel (`npm run build`, `VITE_API_BASE_URL`) |
| Backend | Render (Docker en `Backend/`) |
| Base de datos | Neon (PostgreSQL) |
