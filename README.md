# ginkgo-cam

은행나무·벚꽃 명소 근처 공개 교통 카메라 화면을 몇 분마다 찍어 보여주는 토스 미니앱 '지금 그 길'.

## 구조

| 위치 | 하는 일 |
|---|---|
| `capture/spots.json` | 명소 목록과 처음 보여줄 카메라 이름 |
| `tools/refresh-cams.mjs` | **국내 PC**가 ITS API로 카메라 주소를 받아 S3 비공개 파일 `state/cams.json`에 넣어요. ITS API는 해외·클라우드 IP에서 막혀 있어요 |
| `tools/watchdog.mjs` | PC 작업 스케줄러가 1시간마다 실행. 주소가 18시간 넘었거나 화면이 절반 넘게 실패하면 주소를 새로 받아요 |
| `lambda/index.mjs` | AWS Lambda(서울)가 5분마다 화면을 찍고, 낮에 하루 한 번 노란 잎이 많이 보이는 카메라를 골라 S3에 올려요 |
| `lambda/deploy.ps1` | 버킷·권한·Lambda·5분 예약을 만들거나 고쳐 올려요 (관리자 키 필요) |
| `lambda/setup-refresher.ps1` | PC용 좁은 권한 키(프로필 `ntr-refresh`)를 만들어요 |
| `app/` | 토스 미니앱 (Vite + React + TDS). `npm run build`로 `.ait` 생성 |

공개 주소: `https://now-that-road-cam-6201bde4.s3.ap-northeast-2.amazonaws.com/spots.json`, `snap/<id>.jpg`, `thumb/<id>.jpg`

출처: 국가교통정보센터(ITS) 교통 CCTV. 카메라 주소에는 API 키가 들어 있어서 S3의 비공개 경로(`state/`)에만 둬요.

## PC 준비

1. `tools/.its-key` 파일에 ITS 키를 한 줄로 저장 (저장소에 안 올라가요)
2. AWS 프로필 `ntr-refresh` (setup-refresher.ps1로 생성)
3. 작업 스케줄러 'ginkgo-cam 주소 점검'이 1시간마다 `node tools/watchdog.mjs` 실행
