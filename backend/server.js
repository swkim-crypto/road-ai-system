const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

// ── HTML 서빙: KAKAO_KEY를 직접 삽입
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '../frontend/public/index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace('__KAKAO_KEY__', process.env.KAKAO_JS_KEY || '');
  res.send(html);
});

// ── 정적 파일 (CSS, JS 등)
app.use(express.static(path.join(__dirname, '../frontend/public')));

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

// ── SPA fallback
app.get('*', (req, res) => {
  const htmlPath = path.join(__dirname, '../frontend/public/index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace('__KAKAO_KEY__', process.env.KAKAO_JS_KEY || '');
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행: http://localhost:${PORT}`));
