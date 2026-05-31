const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const wellknown = require('wellknown');     // npm i wellknown   (proj4 불필요 — 저장이 이미 WGS84)

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const FUSEKI = process.env.FUSEKI_URL || 'http://localhost:3030/road/sparql';

// 저장 WKT 리터럴: "<...CRS84> POINT(lon lat)" → CRS URI 접두만 제거, 좌표는 그대로 WGS84
function wktToGeometry(wkt) {
  return wellknown.parse(wkt.replace(/^\s*<[^>]+>\s*/, ''));
}
async function sparqlSelect(query) {
  const r = await fetch(FUSEKI + '?query=' + encodeURIComponent(query), {
    headers: { 'Accept': 'application/sparql-results+json' }
  });
  if (!r.ok) throw new Error('Fuseki ' + r.status);
  return (await r.json()).results.bindings;
}

// ── 지도 데이터: 정적 GeoJSON 대신 Fuseki 질의 → GeoJSON (좌표 변환 불필요)
//    ?type=라벨  으로 시설물 종류 필터 (예: /data.geojson?type=CCTV)
app.get('/data.geojson', async (req, res) => {
  const typeFilter = req.query.type
    ? `?f rdfs:label ?label . FILTER(STR(?label) = ${JSON.stringify(req.query.type)})`
    : `?f rdfs:label ?label .`;
  const q = `
    PREFIX geo:  <http://www.opengis.net/ont/geosparql#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT ?f ?label ?wkt WHERE {
      ?f geo:hasGeometry/geo:asWKT ?wkt .
      ${typeFilter}
    } LIMIT 200000`;
  try {
    const rows = await sparqlSelect(q);
    const features = rows.map(b => ({
      type: 'Feature',
      properties: { id: b.f.value.split(/[#/]/).pop(), label: b.label?.value || '' },
      geometry: wktToGeometry(b.wkt.value)
    })).filter(f => f.geometry);
    res.json({ type: 'FeatureCollection', features });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── (선택) AI/UI 가 임의 SPARQL 을 던질 수 있는 통로
app.post('/api/sparql', async (req, res) => {
  try { res.json(await sparqlSelect(req.body.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HTML 서빙: KAKAO_KEY 삽입
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '../frontend/public/index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace('__KAKAO_KEY__', process.env.KAKAO_JS_KEY || '');
  res.send(html);
});

// ── 정적 파일 (data.geojson 라우트는 위에서 이미 처리)
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Claude API 프록시 (변경 없음)
app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: 'API Key가 서버에 설정되지 않았습니다.' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: system || '',
        messages
      })
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || '오류' });
    }
    const data = await response.json();
    res.json({ content: data.content[0]?.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SPA fallback
app.get('*', (req, res) => {
  const htmlPath = path.join(__dirname, '../frontend/public/index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace('__KAKAO_KEY__', process.env.KAKAO_JS_KEY || '');
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행: http://localhost:${PORT}`));
