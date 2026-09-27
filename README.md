# MusicTube

가사 싱크를 맞춰 음악 영상을 만드는 로컬 앱입니다.

## 시작하기

필요: Node.js 22+, YouTube Data API v3 키

```bash
npm run setup:local
```

`.env.local`에 `YOUTUBE_API_KEY`를 설정한 뒤 실행합니다.

```bash
npm run local
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 종료는 `Ctrl+C`입니다.

## 사용법

YouTube Music에서 곡을 검색·선택하면 음원은 yt-dlp로 가져오고, 가사와 표지는 Genie에서 가져옵니다. 제목과 가사를 편집하고 미리 본 뒤 MP4로 내보냅니다. 사용 권한이 있는 음원만 사용하세요.
