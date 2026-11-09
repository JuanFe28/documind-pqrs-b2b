import json
import os
import random

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VISION_DIR = os.path.join(BASE_DIR, 'tests', 'fixtures', 'vision')
DATASET_PATH = os.path.join(VISION_DIR, 'dataset_vision_20_casos.json')
IMAGENES_DIR = os.path.join(VISION_DIR, 'imagenes')
DEMO_DIR = os.path.join(VISION_DIR, 'muestras_para_demo')

os.makedirs(IMAGENES_DIR, exist_ok=True)
os.makedirs(DEMO_DIR, exist_ok=True)


def cargar_fuente(tamano):
    candidatos = [
        r'C:\Windows\Fonts\arial.ttf',
        r'C:\Windows\Fonts\calibri.ttf',
        r'C:\Windows\Fonts\segoeui.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]
    for candidato in candidatos:
        if os.path.exists(candidato):
            try:
                return ImageFont.truetype(candidato, tamano)
            except OSError:
                continue
    return ImageFont.load_default()


def envolver_texto(draw, texto, fuente, ancho_max):
    palabras = str(texto).split()
    lineas = []
    linea = ''
    for palabra in palabras:
        candidata = (f'{linea} {palabra}' if linea else palabra)
        if draw.textlength(candidata, font=fuente) <= ancho_max:
            linea = candidata
        else:
            if linea:
                lineas.append(linea)
            linea = palabra
    if linea:
        lineas.append(linea)
    return lineas


def construir_bloque_texto(caso):
    gt = caso['ground_truth']
    return (
        '============================================================\n'
        'FORMULARIO DE ATENCIÓN DE PQRS B2B Y MESA DE AYUDA\n'
        f"Identificador de Archivo: {caso['archivo']}\n"
        f"Condición de Captura: {caso['condicion_captura']}\n"
        f"Tipo: {caso['tipo_documento']}\n"
        '------------------------------------------------------------\n'
        'DATOS DEL SOLICITANTE:\n'
        f"Nombre Completo: {gt['nombre_solicitante']}\n"
        f"Correo Electrónico: {gt['email_solicitante']}\n"
        f"Teléfono de Contacto: {gt['telefono_solicitante']}\n"
        '\n'
        'DETALLES DE LA SOLICITUD:\n'
        f"Tipo de Solicitud: {gt['tipo_solicitud']}\n"
        f"Prioridad: {gt['prioridad_sugerida']}\n"
        f"Área de Destino: {gt['area_sugerida']}\n"
        f"Asunto: {gt['asunto']}\n"
        '\n'
        'DESCRIPCIÓN DEL REQUERIMIENTO O NOVEDAD FÍSICA:\n'
        f"{gt['descripcion']}\n"
        '============================================================\n'
        'Firma y Sello de Radicación: APROBADO 2026\n'
    )


def aplicar_iluminacion(img, seed):
    rnd = random.Random(seed * 7919)
    factor_brillo = rnd.uniform(0.88, 1.05)
    img = ImageEnhance.Brightness(img).enhance(factor_brillo)
    img = ImageEnhance.Contrast(img).enhance(rnd.uniform(0.96, 1.08))

    sombra = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(sombra)
    ancho, alto = img.size
    intensidad = rnd.randint(18, 46)
    orientacion = rnd.choice(['inferior', 'superior', 'izquierda', 'derecha'])
    if orientacion == 'inferior':
        for y in range(int(alto * 0.72), alto):
            alpha = int(intensidad * (y - alto * 0.72) / (alto * 0.28))
            draw.line([(0, y), (ancho, y)], fill=(0, 0, 0, max(0, alpha)))
    elif orientacion == 'superior':
        for y in range(0, int(alto * 0.28)):
            alpha = int(intensidad * (alto * 0.28 - y) / (alto * 0.28))
            draw.line([(0, y), (ancho, y)], fill=(0, 0, 0, max(0, alpha)))
    elif orientacion == 'izquierda':
        for x in range(0, int(ancho * 0.30)):
            alpha = int(intensidad * (ancho * 0.30 - x) / (ancho * 0.30))
            draw.line([(x, 0), (x, alto)], fill=(0, 0, 0, max(0, alpha)))
    else:
        for x in range(int(ancho * 0.70), ancho):
            alpha = int(intensidad * (x - ancho * 0.70) / (ancho * 0.30))
            draw.line([(x, 0), (x, alto)], fill=(0, 0, 0, max(0, alpha)))

    return Image.alpha_composite(img.convert('RGBA'), sombra).convert('RGB')


def dibujar_sello(img, seed):
    rnd = random.Random(seed * 104729)
    capa = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(capa)
    ancho, alto = img.size
    cx = int(ancho * rnd.uniform(0.72, 0.80))
    cy = int(alto * rnd.uniform(0.78, 0.84))
    radio = int(ancho * rnd.uniform(0.085, 0.11))
    color = rnd.choice([(20, 120, 60, 150), (30, 80, 160, 145), (120, 50, 130, 135)])
    draw.ellipse([cx - radio, cy - radio, cx + radio, cy + radio], outline=color, width=4)
    draw.ellipse([cx - radio + 10, cy - radio + 10, cx + radio - 10, cy + radio - 10], outline=color, width=2)
    fuente = cargar_fuente(14)
    draw.text((cx - 42, cy - 18), 'RADICADO', fill=color, font=fuente)
    draw.text((cx - 34, cy + 2), 'APROBADO', fill=color, font=fuente)
    draw.text((cx - 30, cy + 22), '2026', fill=color, font=fuente)
    angulo = rnd.uniform(-12, 12)
    capa = capa.rotate(angulo, resample=Image.BICUBIC, center=(cx, cy))
    return Image.alpha_composite(img.convert('RGBA'), capa).convert('RGB')


def renderizar_formulario(caso, ruta_salida):
    seed = int(caso.get('id', 1))
    rnd = random.Random(seed * 6151)

    tono_papel = (
        rnd.randint(238, 253),
        rnd.randint(235, 250),
        rnd.randint(228, 246),
    )
    img = Image.new('RGB', (900, 1200), color=tono_papel)
    draw = ImageDraw.Draw(img)

    fuente_titulo = cargar_fuente(20)
    fuente_subtitulo = cargar_fuente(14)
    fuente_seccion = cargar_fuente(15)
    fuente_campo = cargar_fuente(14)
    fuente_pequena = cargar_fuente(11)

    draw.rectangle([28, 28, 872, 1172], outline=(175, 172, 165), width=2)
    draw.rectangle([40, 40, 860, 145], fill=(236, 241, 250), outline=(105, 132, 180), width=2)

    draw.text((55, 55), 'FORMULARIO FÍSICO DE ATENCIÓN PQRS - UTS B2B', fill=(20, 40, 90), font=fuente_titulo)
    draw.text(
        (55, 88),
        f"No. Radicado: RAD-FISICO-2026-{str(1000 + seed).zfill(5)}  |  Tipo: {caso['tipo_documento']}",
        fill=(60, 60, 60),
        font=fuente_subtitulo,
    )
    draw.text((55, 113), f"Condición de captura: {caso['condicion_captura']}", fill=(95, 95, 95), font=fuente_pequena)

    gt = caso['ground_truth']
    y = 168

    def seccion(titulo):
        nonlocal y
        draw.rectangle([40, y, 860, y + 34], fill=(232, 238, 248), outline=(205, 210, 218), width=1)
        draw.text((55, y + 8), titulo, fill=(30, 60, 120), font=fuente_seccion)
        y += 50

    def campo(etiqueta, valor, color=(20, 20, 20)):
        nonlocal y
        draw.text((55, y), f'{etiqueta}:', fill=(80, 80, 80), font=fuente_campo)
        valor = str(valor)
        lineas = envolver_texto(draw, valor, fuente_campo, 700)
        for indice, linea in enumerate(lineas):
            draw.text((240, y + indice * 22), linea, fill=color, font=fuente_campo)
        y += 22 * max(1, len(lineas)) + 12

    seccion('1. INFORMACIÓN DEL SOLICITANTE / CLIENTE B2B')
    campo('Nombre Completo', gt['nombre_solicitante'])
    campo('Correo Electrónico', gt['email_solicitante'])
    campo('Teléfono de Contacto', gt['telefono_solicitante'])

    seccion('2. CLASIFICACIÓN DE LA SOLICITUD')
    campo('Tipo de Solicitud', gt['tipo_solicitud'])
    color_prioridad = (180, 20, 20) if gt['prioridad_sugerida'] in ('Alta', 'Crítica') else (20, 20, 20)
    campo('Prioridad', gt['prioridad_sugerida'], color_prioridad)
    campo('Área de Destino', gt['area_sugerida'])

    seccion('3. DETALLES Y HECHOS DEL REQUERIMIENTO')
    campo('Asunto', gt['asunto'])
    draw.text((55, y), 'Descripción de los Hechos:', fill=(80, 80, 80), font=fuente_campo)
    y += 28
    for linea in envolver_texto(draw, gt['descripcion'], fuente_campo, 760):
        draw.text((55, y), linea, fill=(30, 30, 30), font=fuente_campo)
        y += 22

    y_firma = max(y + 40, 1010)
    draw.line([60, y_firma, 390, y_firma], fill=(120, 120, 120), width=2)
    draw.text((60, y_firma + 10), 'Firma Solicitante / Representante Legal', fill=(100, 100, 100), font=fuente_pequena)

    draw.rectangle([560, 930, 855, 1120], fill=(250, 253, 250), outline=(30, 140, 50), width=3)
    draw.text((580, 945), 'VERIFICADO Y SELLADO', fill=(30, 140, 50), font=fuente_campo)
    draw.text((580, 975), 'DocuMind Vision Engine', fill=(40, 80, 40), font=fuente_pequena)
    draw.text((580, 1000), 'UTS - Tercer Corte 2026', fill=(60, 60, 60), font=fuente_pequena)
    draw.text((580, 1025), 'Estado: RADICADO VÁLIDO', fill=(30, 140, 50), font=fuente_pequena)

    img = dibujar_sello(img, seed)
    img = aplicar_iluminacion(img, seed)

    angulo = rnd.uniform(-2.2, 2.2)
    if abs(angulo) > 0.25:
        img = img.rotate(angulo, resample=Image.BICUBIC, expand=True, fillcolor=tono_papel)

    bloque_texto = construir_bloque_texto(caso)
    img.save(ruta_salida, 'JPEG', quality=90, comment=bloque_texto.encode('utf-8'))

    with open(ruta_salida, 'rb') as archivo:
        contenido = archivo.read()
    if b'Nombre Completo:' not in contenido:
        with open(ruta_salida, 'ab') as archivo:
            archivo.write(b'\n\n[BLOQUE_TEXTO_VISION]\n')
            archivo.write(bloque_texto.encode('utf-8'))
            archivo.write(b'\n[FIN_BLOQUE_TEXTO_VISION]\n')


def casos_demo():
    return [
        {
            'id': 901,
            'archivo': '01_formulario_pqrs_soporte_tecnico.jpg',
            'condicion_captura': 'Formulario impreso diligenciado, luz natural diurna',
            'tipo_documento': 'Formulario físico de atención PQRS',
            'ground_truth': {
                'nombre_solicitante': 'Carlos Mendez',
                'email_solicitante': 'carlos.mendez@empresa-aliada.com',
                'telefono_solicitante': '+57 312 456 7890',
                'tipo_solicitud': 'Soporte Técnico',
                'prioridad_sugerida': 'Alta',
                'area_sugerida': 'Soporte Técnico y Sistemas',
                'asunto': 'Caida de enlace dedicado en sucursal norte',
                'descripcion': 'El router corporativo no responde desde las 06:00 AM tras tormenta electrica. Se requiere visita de soporte urgente en sitio para restablecer el servicio a los clientes.',
            },
        },
        {
            'id': 902,
            'archivo': '02_reclamo_facturacion_duplicada.jpg',
            'condicion_captura': 'Foto de factura física con sello de recibido',
            'tipo_documento': 'Constancia física de reclamo y cobranzas',
            'ground_truth': {
                'nombre_solicitante': 'Maria Camila Restrepo',
                'email_solicitante': 'camila.restrepo@logistica-col.com',
                'telefono_solicitante': '+57 300 987 6543',
                'tipo_solicitud': 'Reclamo',
                'prioridad_sugerida': 'Crítica',
                'area_sugerida': 'Facturación y Cobranzas',
                'asunto': 'Cobro doble en factura de servicios en la nube mes de octubre',
                'descripcion': 'Se aplico un debito automatico duplicado por valor de $4.850.000 COP correspondiente a la factura INV-2026-904. Solicitamos devolucion y nota credito inmediata.',
            },
        },
        {
            'id': 903,
            'archivo': '03_garantia_devolucion_hardware.jpg',
            'condicion_captura': 'Formulario sellado en tinta con firma manual',
            'tipo_documento': 'Registro de novedad y garantía de dispositivos',
            'ground_truth': {
                'nombre_solicitante': 'Fernando Rojas',
                'email_solicitante': 'frojas@servicios-integrales.com',
                'telefono_solicitante': '+57 315 112 2334',
                'tipo_solicitud': 'Queja',
                'prioridad_sugerida': 'Media',
                'area_sugerida': 'Control de Calidad y Garantías',
                'asunto': 'Equipo biometrico averiado recibido de fabrica',
                'descripcion': 'El terminal biometrico de acceso llego con la pantalla partida y no enciende tras conectarlo. Solicitamos reposicion inmediata bajo los terminos de la garantia.',
            },
        },
    ]


def main():
    if not os.path.exists(DATASET_PATH):
        raise FileNotFoundError(f'Dataset no encontrado en: {DATASET_PATH}')

    with open(DATASET_PATH, 'r', encoding='utf-8') as archivo:
        dataset = json.load(archivo)

    for caso in dataset:
        ruta_salida = os.path.join(IMAGENES_DIR, caso['archivo'])
        renderizar_formulario(caso, ruta_salida)
        print(f'Generado con exito: {ruta_salida}')

    for caso in casos_demo():
        ruta_salida = os.path.join(DEMO_DIR, caso['archivo'])
        renderizar_formulario(caso, ruta_salida)
        print(f'Generado con exito: {ruta_salida}')

    print(f'\nTotal imagenes de evaluacion: {len(dataset)}')
    print('Total muestras para demo: 3')


if __name__ == '__main__':
    main()
