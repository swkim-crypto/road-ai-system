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

// ── AI → SPARQL 분석 도우미 ───────────────────────────────────────────
// 시설물 라벨 목록(캐시) — AI 프롬프트에 실제 종류를 넣어 정확한 질의를 쓰게 함.
let _labelsCache = null;
async function getLabels() {
  if (_labelsCache) return _labelsCache;
  try {
    const rows = await sparqlSelect(`
      PREFIX geo:  <http://www.opengis.net/ont/geosparql#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?label WHERE {
        ?f geo:hasGeometry/geo:asWKT ?w ; rdfs:label ?label .
      } ORDER BY ?label`);
    _labelsCache = rows.map(b => b.label.value);
  } catch (e) { _labelsCache = []; }
  return _labelsCache;
}

// AI 에게 주는 SPARQL 작성 규칙 + 우리 스키마 치트시트
function buildSchemaPrompt(labels) {
  return `[SPARQL 분석 규칙 — 지도 표시용]
사용자의 공간/분류 질문에 답할 때, 한국어 답변 뒤에 아래 형식의 SPARQL 한 개를 붙이면
서버가 그걸 Fuseki(읽기전용)에 실행해 결과를 지도에 표시한다. 규칙을 정확히 지킬 것.

프리픽스:
  PREFIX geo:      <http://www.opengis.net/ont/geosparql#>
  PREFIX rdfs:     <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX rl:       <http://example.org/road-ledger#>
  PREFIX spatialF: <http://jena.apache.org/function/spatial#>
  PREFIX uom:      <http://www.opengis.net/def/uom/OGC/1.0/>

핵심 패턴:
- 시설물 기하: ?f geo:hasGeometry/geo:asWKT ?wkt .   (지도에 그릴 거면 반드시 ?wkt 를 SELECT)
- 종류 필터: ?f rdfs:label ?label . FILTER(STR(?label) = "CCTV")
- 거리(미터): spatialF:distance(?w1, ?w2, uom:metre)  ← 반드시 이 함수. geof:distance 는 이 환경에서 빈 값(쓰지 말 것).
- 최근접 N개: 원점 시설의 ?wkt 를 bind → 거리 계산 → ORDER BY ASC(?dist) LIMIT N. 대상은 점형이 안정적.
- 기하형태: rl:PointFacility / rl:LineFacility / rl:AreaFacility
- 기능분류(선택): ?f a/rdfs:subClassOf* rl:SafetyFacility . (집계 땐 COUNT(DISTINCT ?f))
- 반드시 SELECT 질의만. INSERT/DELETE 등 금지. 반드시 LIMIT(<=300) 포함.

사용 가능한 종류 라벨(정확히 이 문자열로 필터):
${labels.join(', ')}

출력 형식: 한국어로 짧게 답한 뒤, 지도에 표시할 시설물 결과가 있을 때만 마지막에 정확히 한 개:
\`\`\`sparql
SELECT ?f ?label ?wkt WHERE { ... } LIMIT 100
\`\`\`
단순 설명/대화면 이 블록을 생략한다. (?dist 등 추가 변수는 결과 속성으로 표시됨)`;
}

function extractSparql(text) {
  const m = text.match(/```sparql\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}
function isReadOnlySparql(q) {
  return !/\b(INSERT|DELETE|DROP|CLEAR|LOAD|CREATE|ADD|MOVE|COPY)\b/i.test(q);
}
// SPARQL 결과 bindings → GeoJSON (?wkt 컬럼을 기하로, 나머지는 속성으로)
function coordsFinite(coords) {
  if (typeof coords[0] === 'number') return isFinite(coords[0]) && isFinite(coords[1]);
  return coords.every(coordsFinite);
}
function rowsToGeoJSON(rows) {
  const vars = rows.length ? Object.keys(rows[0]) : [];
  const sampleWkt = rows.length && rows[0].wkt ? String(rows[0].wkt.value).slice(0, 120) : null;
  const features = rows.map(b => {
    if (!b.wkt) return null;
    const geometry = wktToGeometry(b.wkt.value);
    if (!geometry || !geometry.coordinates || !coordsFinite(geometry.coordinates)) return null;
    const properties = {};
    for (const k in b) {
      if (k === 'wkt') continue;
      properties[k] = b[k].value;
      if (k === 'f') properties.id = b[k].value.split(/[#/]/).pop();
    }
    return { type: 'Feature', properties, geometry };
  }).filter(Boolean);
  return { type: 'FeatureCollection', features, debug: { rows: rows.length, drawn: features.length, vars, sampleWkt } };
}

// ── 시설물 종류별 개수만 반환 (기하 없음 → 가볍고 메모리 안전). 패널/총계용.
app.get('/data.stats', async (req, res) => {
  const q = `
    PREFIX geo:  <http://www.opengis.net/ont/geosparql#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT ?label (COUNT(?f) AS ?n) WHERE {
      ?f geo:hasGeometry/geo:asWKT ?wkt ; rdfs:label ?label .
    } GROUP BY ?label`;
  try {
    const rows = await sparqlSelect(q);
    const stats = {};
    rows.forEach(b => { stats[b.label.value] = parseInt(b.n.value, 10); });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 지도 데이터: 정적 GeoJSON 대신 Fuseki 질의 → GeoJSON (좌표 변환 불필요)
//    반드시 ?type=라벨 으로 종류별 호출 (예: /data.geojson?type=CCTV)
//    무필터 전체 호출은 22,989건을 한 번에 메모리로 올려 OOM 을 내므로 막는다.
app.get('/data.geojson', async (req, res) => {
  if (!req.query.type) {
    return res.status(400).json({
      error: 'type 파라미터가 필요합니다. 종류별로 호출하세요 (예: /data.geojson?type=CCTV). ' +
             '전체 목록은 /data.stats 에서 확인하세요.'
    });
  }
  const typeFilter = `?f rdfs:label ?label . FILTER(STR(?label) = ${JSON.stringify(req.query.type)})`;
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

// ── Claude API 프록시 + AI 생성 SPARQL 실행 → 지도용 GeoJSON
app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: 'API Key가 서버에 설정되지 않았습니다.' });
  try {
    const labels = await getLabels();
    const fullSystem = (system || '') + '\n\n' + buildSchemaPrompt(labels);
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
        system: fullSystem,
        messages
      })
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || '오류' });
    }
    const data = await response.json();
    let content = data.content[0]?.text || '';

    // AI 가 SPARQL 을 붙였으면 실행 → GeoJSON. 실패해도 답변은 그대로 전달.
    const sparql = extractSparql(content);
    let geojson = null;
    if (sparql) {
      content = content.replace(/```sparql[\s\S]*?```/i, '').trim();
      if (isReadOnlySparql(sparql)) {
        try {
          const rows = await sparqlSelect(sparql);
          geojson = rowsToGeoJSON(rows);
        } catch (e) {
          geojson = { error: e.message };
        }
      } else {
        geojson = { error: '읽기 전용 질의만 허용됩니다.' };
      }
    }
    // 빈 답변 방지 — 빈 assistant 메시지는 다음 API 호출을 깨뜨림
    if (!content || !content.trim()) {
      content = geojson && geojson.features && geojson.features.length
        ? `요청하신 ${geojson.features.length}건을 지도에 표시했습니다.`
        : '분석을 완료했습니다.';
    }
    res.json({ content, geojson, sparql });
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
