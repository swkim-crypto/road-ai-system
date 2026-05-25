# 정밀도로지도 AI 분석 시스템

카카오맵 + Claude AI 기반 도로대장 TTL 분석 시스템

## 프로젝트 구조

```
road-ai-system/
├── backend/
│   └── server.js          # Express 서버 (API 프록시)
├── frontend/
│   └── public/
│       └── index.html     # 단일 페이지 앱
├── .env.example           # 환경변수 예시
├── .gitignore
├── package.json
└── README.md
```

## 로컬 개발

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일에 실제 Key 입력

# 3. 서버 실행
npm start
# → http://localhost:3000
```

## Render 배포

### 1. GitHub에 Push

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_ID/road-ai-system.git
git push -u origin main
```

### 2. Render 설정

1. [render.com](https://render.com) → New → **Web Service**
2. GitHub 저장소 연결
3. 설정값:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment Variables** 탭에서 추가:
   - `ANTHROPIC_API_KEY` = `sk-ant-api03-...`
   - `KAKAO_JS_KEY` = `카카오 JS Key`
   - `ALLOWED_ORIGIN` = `https://your-app-name.onrender.com`

### 3. 카카오 도메인 등록

[Kakao Developers](https://developers.kakao.com) → 앱 선택 → 플랫폼 → Web → 사이트 도메인에 Render URL 추가:
```
https://your-app-name.onrender.com
```

## API Key 보안

- `ANTHROPIC_API_KEY`는 서버 환경변수에만 존재
- 브라우저(클라이언트)에는 절대 노출되지 않음
- 모든 Claude API 호출은 `/api/chat` 프록시를 통해서만 이루어짐
- `.env` 파일은 `.gitignore`에 포함되어 GitHub에 올라가지 않음
