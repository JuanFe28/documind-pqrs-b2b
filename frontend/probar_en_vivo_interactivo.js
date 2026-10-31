import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

async function ejecutarDemostracionEnVivo() {
  console.log('\n================================================================');
  console.log('🎬 INICIANDO DEMOSTRACIÓN VISUAL E2E EN VIVO (MICROSOFT EDGE)');
  console.log('   Requisito Componentes 1 y 2 - Tercer Corte UTS 2026');
  console.log('================================================================\n');

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const muestraImagen = path.resolve('..', 'tests', 'fixtures', 'vision', 'muestras_para_demo', '01_formulario_pqrs_soporte_tecnico.jpg');

  console.log(`📁 Foto de formulario físico a usar: ${muestraImagen}`);

  // Lanzar navegador VISIBLE para el usuario con cámara lenta
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: false,
    defaultViewport: null,
    slowMo: 90, // Permite ver las pulsaciones de teclas y clics claramente
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // FASE 1: INICIO DE SESIÓN VISIBLE
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n👉 [FASE 1] Abriendo Login (http://localhost:5173/login)...');
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle0' });
    await esperar(1200);

    console.log('⌨️  Tecleando correo de funcionario (admin@documind.com)...');
    const emailInput = await page.$('input[type="email"], input[id="email"]');
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type('admin@documind.com', { delay: 50 });
    }

    console.log('🔒 Tecleando contraseña de seguridad...');
    const passInput = await page.$('input[type="password"], input[id="password"]');
    if (passInput) {
      await passInput.click({ clickCount: 3 });
      await passInput.type('password_seguro_uts', { delay: 50 });
    }

    await esperar(800);
    console.log('🖱️  Haciendo clic en "Iniciar Sesión"...');
    const btnLogin = await page.$('button[type="submit"]');
    if (btnLogin) {
      await btnLogin.click();
    }
    await esperar(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // FASE 2: DIGITALIZACIÓN CON VISIÓN IA MULTIMODAL (/vision)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n👉 [FASE 2] Navegando al Módulo de Visión IA (/vision)...');
    await page.goto('http://localhost:5173/vision', { waitUntil: 'networkidle0' });
    await esperar(1500);

    if (fs.existsSync(muestraImagen)) {
      console.log('📷 Cargando foto real del formulario físico...');
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(muestraImagen);
        await esperar(2000);

        console.log('🤖 Haciendo clic en "Analizar con Visión por Computador"...');
        const btnAnalizar = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(b => b.textContent.includes('Analizar con Visión') || b.textContent.includes('Analizar'));
        });

        if (btnAnalizar && btnAnalizar.click) {
          await btnAnalizar.click();
        }

        console.log('⏳ Esperando extracción estructurada y cálculo de confianza (score e IA)...');
        await esperar(5000);

        console.log('⚡ Haciendo clic en "Confirmar y Radicar Ticket PQRS" (Dispara Automatización)...');
        const btnConfirmarRadicar = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(b => b.textContent.includes('Confirmar y Radicar') || b.textContent.includes('Radicar Ticket'));
        });

        if (btnConfirmarRadicar && btnConfirmarRadicar.click) {
          await btnConfirmarRadicar.click();
          await esperar(3000);
          console.log('✅ Formulario físico radicado en vivo como Ticket oficial.');
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FASE 3: RADICACIÓN CIUDADANA EN VIVO (/radicar)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n👉 [FASE 3] Abriendo Portal Público de Radicación (/radicar)...');
    await page.goto('http://localhost:5173/radicar', { waitUntil: 'networkidle0' });
    await esperar(1500);

    console.log('✍️  Diligenciando campos del formulario en tiempo real...');
    const nombreF = await page.$('input[name="nombre"]');
    if (nombreF) await nombreF.type('Ing. Carlos Alberto Morales', { delay: 40 });

    const emailF = await page.$('input[name="email"]');
    if (emailF) await emailF.type('carlos.morales@distribuidora-norte.com', { delay: 40 });

    const telF = await page.$('input[name="telefono"]');
    if (telF) await telF.type('+57 312 456 7890', { delay: 40 });

    const tipoSelect = await page.$('select[name="tipo_solicitud"]');
    if (tipoSelect) {
      await tipoSelect.select('Soporte Técnico');
      await esperar(400);
    }

    const asuntoF = await page.$('input[name="asunto"]');
    if (asuntoF) await asuntoF.type('Intermitencia en terminales de cobro POS sucursal Bucaramanga', { delay: 35 });

    const descF = await page.$('textarea[name="descripcion"]');
    if (descF) {
      await descF.type(
        'El 31 de octubre a las 11:30 AM los datafonos perdieron conexión con el gateway principal. Se solicita restablecimiento urgente bajo el acuerdo de SLA empresarial.',
        { delay: 25 }
      );
    }

    await esperar(1000);
    console.log('🚀 Haciendo clic en enviar radicado...');
    const btnSubmitRadicar = await page.$('button[type="submit"]');
    if (btnSubmitRadicar) {
      await btnSubmitRadicar.click();
    }

    await esperar(3000);
    console.log('🎉 ¡Constancia de radicación generada con SLA y Clave Privada visible en pantalla!');

    // ══════════════════════════════════════════════════════════════════════════
    // FASE 4: BANDEJA OPERATIVA (/pqrs)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n👉 [FASE 4] Navegando a Mesa de Ayuda PQRS (/pqrs)...');
    await page.goto('http://localhost:5173/pqrs', { waitUntil: 'networkidle0' });
    await esperar(2000);

    console.log('\n🌟 DEMOSTRACIÓN EN VIVO FINALIZADA CON ÉXITO.');
    console.log('👀 La ventana de Microsoft Edge quedará abierta 60 SEGUNDOS para que puedas interactuar libremente.');
    await esperar(60000);

  } catch (err) {
    console.error('❌ Error durante la demostración en vivo:', err.message);
  } finally {
    try {
      await browser.close();
      console.log('🚪 Navegador cerrado automáticamente al finalizar el tiempo de inspección.');
    } catch (_) {}
  }
}

ejecutarDemostracionEnVivo();
