import os
from PIL import Image, ImageDraw, ImageFont

target_dir = os.path.join('tests', 'fixtures', 'vision', 'muestras_para_demo')
os.makedirs(target_dir, exist_ok=True)

samples = [
    {
        'file': os.path.join(target_dir, '01_formulario_pqrs_soporte_tecnico.jpg'),
        'title': 'FORMULARIO FISICO DE ATENCION PQRS - UTS B2B',
        'radicado': 'RAD-FISICO-2026-00841',
        'fecha': '31/OCT/2026 - 08:30 AM',
        'solicitante': 'Carlos Mendez',
        'email': 'carlos.mendez@empresa-aliada.com',
        'telefono': '+57 312 456 7890',
        'tipo': 'Soporte Tecnico',
        'prioridad': 'Alta',
        'asunto': 'Caida de enlace dedicado en sucursal norte',
        'desc': 'El router corporativo no responde desde las 06:00 AM tras tormenta electrica. Se requiere visita de soporte urgente en sitio para restablecer el servicio a los clientes.',
        'estado_doc': 'RECEPCION OFICINA PRINCIPAL - BUCARAMANGA'
    },
    {
        'file': os.path.join(target_dir, '02_reclamo_facturacion_duplicada.jpg'),
        'title': 'CONSTANCIA FISICA DE RECLAMO Y COBRANZAS',
        'radicado': 'RAD-FISICO-2026-00912',
        'fecha': '31/OCT/2026 - 09:15 AM',
        'solicitante': 'Maria Camila Restrepo',
        'email': 'camila.restrepo@logistica-col.com',
        'telefono': '+57 300 987 6543',
        'tipo': 'Reclamo',
        'prioridad': 'Critica',
        'asunto': 'Cobro doble en factura de servicios en la nube mes de octubre',
        'desc': 'Se aplico un debito automatico duplicado por valor de $4.850.000 COP correspondiente a la factura INV-2026-904. Solicitamos devolucion y nota credito inmediata.',
        'estado_doc': 'RADICACION RADICAL FACTURACION - URGENTE'
    },
    {
        'file': os.path.join(target_dir, '03_garantia_devolucion_hardware.jpg'),
        'title': 'REGISTRO DE NOVEDAD Y GARANTIA DE DISPOSITIVOS',
        'radicado': 'RAD-FISICO-2026-01045',
        'fecha': '31/OCT/2026 - 09:45 AM',
        'solicitante': 'Fernando Rojas',
        'email': 'frojas@servicios-integrales.com',
        'telefono': '+57 315 112 2334',
        'tipo': 'Queja',
        'prioridad': 'Media',
        'asunto': 'Equipo biometrico averiado recibido de fabrica',
        'desc': 'El terminal biometrico de acceso llego con la pantalla partida y no enciende tras conectarlo. Solicitamos reposicion inmediata bajo los terminos de la garantia.',
        'estado_doc': 'CONTROL DE CALIDAD Y DEVOLUCIONES'
    }
]

for s in samples:
    img = Image.new('RGB', (800, 1050), color=(250, 248, 244))
    draw = ImageDraw.Draw(img)

    draw.rectangle([25, 25, 775, 1025], outline=(180, 180, 175), width=2)
    draw.rectangle([35, 35, 765, 125], fill=(235, 240, 250), outline=(100, 130, 180), width=2)

    draw.text((50, 48), s['title'], fill=(20, 40, 90))
    draw.text((50, 75), f"No. Radicado Fisico: {s['radicado']}  |  Fecha: {s['fecha']}", fill=(60, 60, 60))
    draw.text((50, 98), f"Sede: {s['estado_doc']}", fill=(100, 100, 100))

    draw.rectangle([35, 145, 765, 320], fill=(255, 255, 255), outline=(200, 200, 200), width=1)
    draw.text((50, 155), '1. INFORMACION DEL SOLICITANTE / CLIENTE B2B', fill=(30, 60, 120))
    draw.line([50, 175, 750, 175], fill=(220, 220, 220), width=1)
    draw.text((50, 190), f"Nombre Completo:    {s['solicitante']}", fill=(20, 20, 20))
    draw.text((50, 230), f"Correo Electronico: {s['email']}", fill=(20, 20, 20))
    draw.text((50, 270), f"Telefono Movil:     {s['telefono']}", fill=(20, 20, 20))

    draw.rectangle([35, 340, 765, 480], fill=(255, 255, 255), outline=(200, 200, 200), width=1)
    draw.text((50, 350), '2. CLASIFICACION DE LA SOLICITUD', fill=(30, 60, 120))
    draw.line([50, 370, 750, 370], fill=(220, 220, 220), width=1)
    draw.text((50, 390), f"Tipo de Requerimiento:  {s['tipo']}", fill=(20, 20, 20))
    draw.text((50, 430), f"Nivel de Prioridad:     {s['prioridad']}", fill=(180, 20, 20) if s['prioridad'] in ['Alta', 'Critica'] else (20, 20, 20))

    draw.rectangle([35, 500, 765, 820], fill=(255, 255, 255), outline=(200, 200, 200), width=1)
    draw.text((50, 510), '3. DETALLES Y HECHOS DEL REQUERIMIENTO', fill=(30, 60, 120))
    draw.line([50, 530, 750, 530], fill=(220, 220, 220), width=1)
    draw.text((50, 550), 'Asunto:', fill=(80, 80, 80))
    draw.text((50, 575), s['asunto'], fill=(10, 10, 10))
    draw.text((50, 620), 'Descripcion de los Hechos:', fill=(80, 80, 80))
    
    words = s['desc'].split(' ')
    line = ''
    y = 650
    for w in words:
        if len(line + ' ' + w) < 70:
            line += (' ' if line else '') + w
        else:
            draw.text((50, y), line, fill=(30, 30, 30))
            y += 25
            line = w
    if line:
        draw.text((50, y), line, fill=(30, 30, 30))

    draw.rectangle([480, 850, 750, 990], fill=(250, 253, 250), outline=(30, 140, 50), width=3)
    draw.text((500, 865), 'VERIFICADO Y SELLADO', fill=(30, 140, 50))
    draw.text((500, 895), 'DocuMind Vision Engine', fill=(40, 80, 40))
    draw.text((500, 925), 'UTS - Tercer Corte 2026', fill=(60, 60, 60))
    draw.text((500, 955), 'Estado: RADICADO VALIDO', fill=(30, 140, 50))

    draw.line([60, 960, 350, 960], fill=(120, 120, 120), width=2)
    draw.text((60, 970), 'Firma Solicitante / Representante Legal', fill=(100, 100, 100))

    img.save(s['file'], 'JPEG', quality=92)
    print(f"Generado con exito: {s['file']}")
