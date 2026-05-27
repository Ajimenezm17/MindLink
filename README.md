# MindLink

Aplicación web de salud mental (TFG): citas, seguimiento emocional, chat y panel de administración.

## Estructura

- `Backend/` — API Django + PostgreSQL (Docker)
- `frontend/` — SPA Vite + TypeScript + Tailwind

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

No subas `Backend/.env` al repositorio. Usa `.env.example` como plantilla.

## Despliegue

Frontend (Vercel): build `npm run build`, variable `VITE_API_BASE_URL` apuntando a tu API.

Backend (Render/Railway): Docker desde `Backend/`, Postgres externo (Neon) o plugin del proveedor.
