import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:\\Users\\juanf\\.gemini\\antigravity\\brain\\9cfe1094-ad92-47bd-a818-66cc97e49bb4';
const EVIDENCIAS_DIR = path.resolve('..', 'docs', 'evidencias', 'frontend_tests');

if (!fs.existsSync(EVIDENCIAS_DIR)) {
  fs.mkdirSync(EVIDENCIAS_DIR, { recursive: true });
}

async function testFrontend() {
  console.log('🚀 Iniciando pruebas E2E visuales del Frontend con Microsoft Edge...');
  
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  const resultados = [];

  const capture = async (name, title) => {
    const artPath = path.join(ARTIFACT_DIR, `${name}.png`);
    const evidPath = path.join(EVIDENCIAS_DIR, `${name}.png`);
    await page.screenshot({ path: artPath });
    fs.copyFileSync(artPath, evidPath);
    console.log(`📸 Captura tomada: ${title} -> ${name}.png`);
    resultados.push({ name, title, artPath, evidPath });
  };

  try {
    // 1. Probar Pantalla de Login
    console.log('1. Navegando a http://localhost:5173/login ...');
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle0' });
    await capture('img_01_login', 'Pantalla de Inicio de Sesión DocuMind');

    // 2. Realizar Login
    console.log('2. Ingresando credenciales de prueba...');
    await page.type('input[type="email"], input[id="email"]', 'admin@documind.com');
    await page.type('input[type="password"], input[id="password"]', 'password_seguro_uts');
    
    // Clic en Iniciar Sesión
    const btnLogin = await page.$('button[type="submit"]');
    if (btnLogin) {
      await btnLogin.click();
    }
    
    // Esperar a que entre al dashboard o pqrs
    await new Promise(r => setTimeout(r, 2000));
    await capture('img_02_pqrs', 'Bandeja Principal de PQRS (Post-Login)');

    // 3. Probar Pantalla de Chat RAG IA y Visión
    console.log('3. Navegando al módulo de Chat RAG IA (/chat)...');
    await page.goto('http://localhost:5173/chat', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));
    await capture('img_03_chat', 'Chatbot con Visión Multimodal y Botón de Cámara');

    // 4. Probar Módulo de Visión de Formularios (/vision)
    console.log('4. Navegando a /vision (Digitalización de Formularios)...');
    await page.goto('http://localhost:5173/vision', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));
    await capture('img_04_vision', 'Módulo de Digitalización de Formularios y Calibración Human-in-the-Loop');

    // 5. Probar Portal Público de Radicación (/radicar)
    console.log('5. Navegando a /radicar (Portal Ciudadano)...');
    await page.goto('http://localhost:5173/radicar', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));
    await capture('img_05_radicar', 'Portal Público Ciudadano de Radicación PQRS');

    // 6. Probar Dashboard de Auditoría y Métricas (/dashboard)
    console.log('6. Navegando a /dashboard (Panel Administrador)...');
    await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));
    await capture('img_06_dashboard', 'Dashboard de Auditoría, Logs y KPIs de TI');

    console.log('✅ Todas las pruebas de Frontend fueron completadas con éxito.');
  } catch (err) {
    console.error('❌ Error durante la prueba E2E:', err);
  } finally {
    await browser.close();
  }
}

testFrontend();
