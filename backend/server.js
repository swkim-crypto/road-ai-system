const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
// GeoJSON은 수십MB일 수 있으므로 limit 넉넉하게
app.use(express.json({ limit: '200mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── GeoJSON 수신 & 검증
app.post('/api/load-geojson', (req, res) => {
  const { geojson } = req.body;
  if (!geojson || geojson.type !== 'FeatureCollection') {
    return res.status(400).json({ error: '올바른 GeoJSON FeatureCollection이 아닙니다.' });
  }
  const count = geojson.features?.length || 0;
  const stats = geojson.metadata?.stats || {};
  res.json({ ok: true, count, stats });
});

// ── Claude API 프록시
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

// ── Kakao Key 전달
app.get('/api/config', (req, res) => {
  res.json({ kakaoKey: process.env.KAKAO_JS_KEY || '' });
});

// ── SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행: http://localhost:${PORT}`));
