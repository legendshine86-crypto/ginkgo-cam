# ginkgo-cam

은행나무·벚꽃 명소 근처 공개 교통 카메라 화면을 몇 분마다 찍어 GitHub Pages로 제공하고, 토스 미니앱(`app/`)에서 보여줘요.

## 구조

- `capture/spots.json`: 명소와, 그 명소 대신 보여줄 근처 카메라 이름
- `tools/refresh-cams.mjs`: **국내 PC에서** ITS API로 카메라 주소를 받아 GitHub 비밀값 `CAMS`에 넣어요 (ITS API는 해외 접속이 막혀 있어요). 하루 3번, 월 90번까지만 불러요
- `capture/capture.mjs`: GitHub Actions가 5~15분마다 화면을 찍어 `gh-pages`에 올려요
- 결과: `https://legendshine86-crypto.github.io/ginkgo-cam/spots.json`, `snap/<id>.jpg`, `thumb/<id>.jpg`
- `app/`: 토스 미니앱 (Vite + React + TDS, `npm run build`로 `.ait` 생성)

출처: 국가교통정보센터(ITS) 교통 CCTV. 카메라 주소에는 API 키가 들어 있어서 비밀값으로만 다루고 공개 파일에는 쓰지 않아요.

## PC 준비

1. `tools/.its-key` 파일에 ITS 키를 한 줄로 저장 (저장소에 안 올라가요)
2. `node tools/refresh-cams.mjs` 실행
