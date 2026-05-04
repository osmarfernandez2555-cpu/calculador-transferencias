# DNRPA Scraper - Tutu Automotores

Calcula automáticamente el costo de transferencia consultando el estimador oficial DNRPA.

## Deploy en Railway

### 1. Crear nuevo servicio
- Ir a railway.app → New Project → Deploy from GitHub repo
- O usar Railway CLI: `railway init`

### 2. Variables de entorno (IMPORTANTE)
En Railway → Variables, agregar:
```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### 3. El nixpacks.toml ya está configurado
Railway detecta automáticamente el nixpacks.toml e instala Chromium del sistema.

## Cómo funciona

1. El front (public/index.html) llama a `GET /api/estimar?patente=AA123BB`
2. El server lanza Puppeteer con Chromium headless
3. Abre `https://www2.jus.gob.ar/dnrpa-site/#!/estimador`
4. Completa la patente y pone valor = 1
5. Lee los valores: Costo Trámite + Valor Tabla
6. Calcula: Sellado = 1% del Valor Tabla
7. Total = Costo Trámite + Sellado
8. Devuelve JSON con todos los valores

## Respuesta API

```json
{
  "patente": "AA123BB",
  "costoTramite": 45000,
  "valorTabla": 8500000,
  "sellado": 85000,
  "totalDNRPA": 130000,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## Endpoints

- `GET /` → App web
- `GET /api/estimar?patente=XXXXXXX` → Consulta automática
- `GET /api/health` → Health check
