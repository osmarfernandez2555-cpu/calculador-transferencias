// Forzar Puppeteer a usar su propio Chromium descargado
delete process.env.PUPPETEER_EXECUTABLE_PATH;
delete process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cache simple para no spamear el sitio DNRPA
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

app.get('/api/estimar', async (req, res) => {
  const { patente } = req.query;

  if (!patente) {
    return res.status(400).json({ error: 'Falta el parámetro patente' });
  }

  const patenteNorm = patente.toUpperCase().trim();

  // Validar formato patente (vieja AAA000 o nueva AA000AA)
  const formatoViejo = /^[A-Z]{3}\d{3}$/;
  const formatoNuevo = /^[A-Z]{2}\d{3}[A-Z]{2}$/;
  if (!formatoViejo.test(patenteNorm) && !formatoNuevo.test(patenteNorm)) {
    return res.status(400).json({ error: 'Formato de patente inválido. Usá AAA000 o AA000AA' });
  }

  // Verificar cache
  const cacheKey = patenteNorm;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[CACHE] Devolviendo resultado cacheado para ${patenteNorm}`);
    return res.json(cached.data);
  }

  console.log(`[SCRAPER] Iniciando scraping para patente: ${patenteNorm}`);

  let browser;
  try {
  browser = await puppeteer.launch({
  headless: "new",
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--single-process'
  ]
});

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    console.log('[SCRAPER] Navegando al estimador DNRPA...');
    await page.goto('https://www2.jus.gob.ar/dnrpa-site/#!/estimador', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar a que Angular cargue el formulario
    await page.waitForSelector('input', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // Tomar screenshot para debug (solo en desarrollo)
    // await page.screenshot({ path: 'debug1.png' });

    // Buscar el campo de patente - el estimador DNRPA usa ng-model
    // Intentamos varios selectores posibles
    const campoPatente = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      // Buscar input que tenga placeholder o label relacionado con patente/dominio
      for (const input of inputs) {
        const ph = (input.placeholder || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        if (ph.includes('dominio') || ph.includes('patente') || ph.includes('placa') ||
            name.includes('dominio') || name.includes('patente') ||
            id.includes('dominio') || id.includes('patente')) {
          return { found: true, placeholder: input.placeholder, name: input.name, id: input.id };
        }
      }
      // Si no encontramos por nombre, devolver info de todos los inputs para debug
      return { found: false, inputs: inputs.map(i => ({ ph: i.placeholder, name: i.name, id: i.id, type: i.type })) };
    });

    console.log('[SCRAPER] Info campos:', JSON.stringify(campoPatente));

    // Llenar campo de dominio/patente
    let patenteSelector;
    if (campoPatente.found) {
      if (campoPatente.id) patenteSelector = `#${campoPatente.id}`;
      else if (campoPatente.name) patenteSelector = `input[name="${campoPatente.name}"]`;
      else patenteSelector = `input[placeholder="${campoPatente.placeholder}"]`;
    } else {
      // Fallback: primer input de texto visible
      patenteSelector = 'input[type="text"]:not([disabled])';
    }

    await page.click(patenteSelector);
    await page.type(patenteSelector, patenteNorm, { delay: 80 });
    console.log(`[SCRAPER] Patente ingresada: ${patenteNorm}`);

    // Presionar Tab o Enter para pasar al siguiente campo
    await page.keyboard.press('Tab');
    await new Promise(r => setTimeout(r, 1000));

    // Buscar campo de valor/monto y poner 1
    const campoValor = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      for (const input of inputs) {
        const ph = (input.placeholder || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        if (ph.includes('valor') || ph.includes('monto') || ph.includes('precio') ||
            name.includes('valor') || name.includes('monto') || name.includes('precio') ||
            id.includes('valor') || id.includes('monto')) {
          return { found: true, placeholder: input.placeholder, name: input.name, id: input.id };
        }
      }
      return { found: false };
    });

    console.log('[SCRAPER] Campo valor:', JSON.stringify(campoValor));

    let valorSelector;
    if (campoValor.found) {
      if (campoValor.id) valorSelector = `#${campoValor.id}`;
      else if (campoValor.name) valorSelector = `input[name="${campoValor.name}"]`;
      else valorSelector = `input[placeholder="${campoValor.placeholder}"]`;
    } else {
      // Segundo input de texto visible
      valorSelector = 'input[type="number"]:not([disabled])';
    }

    try {
      await page.click(valorSelector);
      await page.type(valorSelector, '1', { delay: 80 });
      console.log('[SCRAPER] Valor 1 ingresado');
    } catch (e) {
      console.log('[SCRAPER] No se pudo llenar valor, continuando...');
    }

    // Buscar y clickear botón calcular/consultar/estimar
    const btnClickeado = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
      for (const btn of btns) {
        const txt = (btn.textContent || btn.value || '').toLowerCase().trim();
        if (txt.includes('calcular') || txt.includes('consultar') || txt.includes('estimar') ||
            txt.includes('buscar') || txt.includes('obtener') || txt.includes('cotizar')) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false, btns: btns.map(b => b.textContent?.trim()) };
    });

    console.log('[SCRAPER] Botón:', JSON.stringify(btnClickeado));

    // Esperar resultados
    await new Promise(r => setTimeout(r, 4000));
    // await page.screenshot({ path: 'debug2.png' });

    // Extraer valores del resultado
    const resultado = await page.evaluate(() => {
      const texto = document.body.innerText;
      
      // Buscar patrones de montos en el texto
      // DNRPA muestra "Costo del Trámite: $XX.XXX,XX" y "Valor de Tabla: $XX.XXX.XXX,XX"
      const extractMonto = (texto, keywords) => {
        for (const kw of keywords) {
          const idx = texto.toLowerCase().indexOf(kw.toLowerCase());
          if (idx !== -1) {
            // Buscar número después del keyword
            const substr = texto.substring(idx, idx + 200);
            const match = substr.match(/\$?\s*([\d.,]+)/);
            if (match) {
              // Convertir formato argentino a número
              let numStr = match[1].replace(/\./g, '').replace(',', '.');
              return parseFloat(numStr);
            }
          }
        }
        return null;
      };

      const costoTramite = extractMonto(texto, ['costo del trámite', 'costo tramite', 'arancel', 'costo:']);
      const valorTabla = extractMonto(texto, ['valor de tabla', 'valor tabla', 'valuación', 'valor fiscal', 'precio referencia']);

      // También intentar extraer de elementos específicos
      const allNumbers = [];
      const moneyEls = document.querySelectorAll('[class*="precio"], [class*="valor"], [class*="costo"], [class*="monto"], [class*="total"], [class*="result"]');
      moneyEls.forEach(el => {
        const txt = el.textContent.trim();
        const match = txt.match(/\$?\s*([\d.,]+)/);
        if (match && txt.length < 100) {
          allNumbers.push({ text: txt, el: el.className });
        }
      });

      return {
        costoTramite,
        valorTabla,
        textoCompleto: texto.substring(0, 2000),
        elementosMonetarios: allNumbers
      };
    });

    console.log('[SCRAPER] Resultado raw:', JSON.stringify(resultado));

    await browser.close();

    if (!resultado.costoTramite && !resultado.valorTabla) {
      // Devolver info de debug para que podamos ajustar los selectores
      return res.status(422).json({
        error: 'No se pudieron extraer los valores. El sitio puede haber cambiado su estructura.',
        debug: {
          textoEncontrado: resultado.textoCompleto,
          elementosMonetarios: resultado.elementosMonetarios
        }
      });
    }

    const sellado = resultado.valorTabla ? resultado.valorTabla * 0.01 : 0;
    const total = (resultado.costoTramite || 0) + sellado;

    const respuesta = {
      patente: patenteNorm,
      costoTramite: resultado.costoTramite,
      valorTabla: resultado.valorTabla,
      sellado: Math.round(sellado),
      totalDNRPA: Math.round(total),
      timestamp: new Date().toISOString()
    };

    // Guardar en cache
    cache.set(cacheKey, { data: respuesta, timestamp: Date.now() });

    res.json(respuesta);

  } catch (err) {
    console.error('[SCRAPER] Error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({
      error: 'Error al consultar el estimador DNRPA',
      detalle: err.message
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', servicio: 'DNRPA Scraper - Tutu Automotores' });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
