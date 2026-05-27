# Usa una imagen oficial de Python
FROM python:3.13-slim

# Establece el directorio de trabajo
WORKDIR /app

# Copia requirements
COPY requirements.txt /app/

# Instala dependencias
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Copia todo el proyecto
COPY . /app/

# Expone el puerto que usará Django
EXPOSE 8000

# Comando por defecto
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]