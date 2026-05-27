from django.db import models


class Administradores(models.Model):
    usuario = models.OneToOneField('Usuarios', models.DO_NOTHING)
    perm_usuarios = models.BooleanField()
    perm_cuestionarios = models.BooleanField()
    perm_citas = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'administradores'


class Citas(models.Model):
    paciente = models.ForeignKey('Pacientes', models.DO_NOTHING)
    profesional = models.ForeignKey('Profesionales', models.DO_NOTHING)
    fecha_hora = models.DateTimeField()
    estado = models.TextField()
    duracion_min = models.SmallIntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'citas'


class Conversaciones(models.Model):
    paciente = models.ForeignKey('Pacientes', models.DO_NOTHING)
    profesional = models.ForeignKey('Profesionales', models.DO_NOTHING)
    fecha_creacion = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'conversaciones'


class Cuestionarios(models.Model):
    titulo = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'cuestionarios'


class Mensajes(models.Model):
    conversacion = models.ForeignKey(Conversaciones, models.DO_NOTHING)
    emisor = models.TextField()
    contenido = models.TextField()
    fecha_envio = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'mensajes'


class Pacientes(models.Model):
    usuario = models.OneToOneField('Usuarios', models.DO_NOTHING)
    fecha_nacimiento = models.DateField()
    telefono = models.CharField(max_length=20)
    profesional = models.ForeignKey('Profesionales', models.DO_NOTHING, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'pacientes'


class Preguntas(models.Model):
    cuestionario = models.ForeignKey(Cuestionarios, models.DO_NOTHING)
    texto = models.TextField()
    tipo = models.TextField()
    orden = models.SmallIntegerField()

    class Meta:
        managed = False
        db_table = 'preguntas'


class Profesionales(models.Model):
    usuario = models.OneToOneField('Usuarios', models.DO_NOTHING)
    especialidad = models.CharField(max_length=150)

    class Meta:
        managed = False
        db_table = 'profesionales'


class AgendaProfesional(models.Model):
    profesional = models.ForeignKey(Profesionales, models.DO_NOTHING)
    dia_semana = models.SmallIntegerField()
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    duracion_min = models.SmallIntegerField()
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    activo = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'agenda_profesional'


class DisponibilidadProfesionalFecha(models.Model):
    profesional = models.ForeignKey(Profesionales, models.DO_NOTHING)
    fecha = models.DateField()
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    duracion_min = models.SmallIntegerField()
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    activo = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'disponibilidad_profesional_fecha'


class ProfesionalAgendaPoliticas(models.Model):
    profesional = models.OneToOneField(Profesionales, models.DO_NOTHING, primary_key=True)
    antelacion_minima_minutos = models.SmallIntegerField()
    horizonte_maximo_dias = models.SmallIntegerField()
    descanso_entre_citas_minutos = models.SmallIntegerField(blank=True, null=True)
    granularidad_minutos = models.SmallIntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'profesional_agenda_politicas'


class ExcepcionAgendaFecha(models.Model):
    id = models.AutoField(primary_key=True)
    profesional = models.ForeignKey(Profesionales, models.DO_NOTHING)
    fecha = models.DateField()
    solo_excepcion = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'excepcion_agenda_fecha'
        unique_together = [['profesional', 'fecha']]


class RegistrosEmocionales(models.Model):
    paciente = models.ForeignKey(Pacientes, models.DO_NOTHING)
    fecha = models.DateTimeField()
    emocion = models.CharField(max_length=100)
    intensidad = models.SmallIntegerField()
    nota = models.TextField(default='', blank=True)

    class Meta:
        managed = False
        db_table = 'registros_emocionales'


class Respuestas(models.Model):
    paciente = models.ForeignKey(Pacientes, models.DO_NOTHING)
    pregunta = models.ForeignKey(Preguntas, models.DO_NOTHING)
    valor = models.TextField()
    fecha = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'respuestas'


class Usuarios(models.Model):
    nombre = models.CharField(max_length=100)
    email = models.CharField(unique=True, max_length=150)
    contrasena = models.CharField(max_length=255)
    rol = models.TextField()
    telefono = models.CharField(max_length=20, blank=True, null=True)
    dni = models.CharField(unique=True, max_length=20, blank=True, null=True)
    ciudad_residencia = models.CharField(max_length=120, blank=True, null=True)
    activo = models.BooleanField()
    fecha_registro = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'usuarios'
