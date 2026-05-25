const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── CORS: Render에서는 같은 origin이므로 프론트도 여기서 서빙
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*'
}));

// ── Static frontend
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Claude API proxy
// API Key는 서버 환경변수에만 존재 → 브라우저에 절대 노출 안 됨
app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API Key가 서버에 설정되지 않았습니다.' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
  }

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
      return res.status(response.status).json({ error: err.error?.message || '알 수 없는 오류' });
    }

    const data = await response.json();
    res.json({ content: data.content[0]?.text || '' });

  } catch (e) {
    console.error('Claude API 오류:', e);
    res.status(500).json({ error: '서버 오류: ' + e.message });
  }
});

// ── Kakao Key 프록시 (선택) — 카카오는 도메인 인증이라 Key 자체 노출은 OK
// 하지만 환경변수로 관리하면 더 깔끔
app.get('/api/config', (req, res) => {
  res.json({
    kakaoKey: process.env.KAKAO_JS_KEY || '',
  });
});

// ── SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
