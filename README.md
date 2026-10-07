# OWASP Juice Shop Docker 환경

의도적으로 취약한 교육용 웹 애플리케이션입니다. 인터넷에 직접 노출하지 말고 격리된 실습 환경에서만 사용하세요.

## 실행

```bash
docker compose up -d
```

로컬에서는 <http://127.0.0.1:3000>, 외부에서는 `http://<서버-IP>:3000`에 접속합니다.

상태 및 로그 확인:

```bash
docker compose ps
docker compose logs -f juice-shop
```

종료:

```bash
docker compose down
```

이미지 업데이트:

```bash
docker compose pull
docker compose up -d
```

## 접속 주소 변경

필요하면 예시 설정을 복사한 후 `.env`를 수정합니다.

```bash
cp .env.example .env
```

기본값인 `JUICE_HOST=0.0.0.0`은 모든 네트워크 인터페이스에 서비스를 노출합니다. 로컬에서만 접속하려면 `JUICE_HOST=127.0.0.1`로 변경하세요.

## sqlmap 실습용 DB 자동 판정 설정

이 Compose 구성은 기본적으로 `JUICE_DB_CHALLENGE_CHECKS=false`를 적용합니다. 요청마다 반복되는 DB 챌린지 판정 13종을 생략해 추가 SQL 조회와 신고 전체 유사도 비교를 줄입니다. 검색·로그인 SQLi를 포함한 실습용 취약점과 관리자 페이지는 유지됩니다. 해당 13종의 자동 완료 판정은 중단되지만, 로그인·검색 등 개별 경로의 다른 판정은 계속 작동합니다.

원래 판정을 다시 사용하려면 `.env`에 `JUICE_DB_CHALLENGE_CHECKS=true`를 설정하고 `docker compose up -d`로 적용합니다. `false`로 바꾸면 다시 끌 수 있습니다. 설정 변경에는 컨테이너 재생성이 필요하며, Juice Shop은 시작할 때 DB와 실습 진행 상태를 초기화합니다.

설정은 읽기 전용으로 연결한 [시작 스크립트](runtime/db-challenge-checks.cjs)를 통해 공식 이미지에 적용됩니다. `src`를 수정하거나 이미지 내부 파일을 덮어쓰지 않습니다. 적용되면 컨테이너 로그에 `Per-request DB challenge checks disabled`가 표시됩니다.

관리자 페이지: `http://서버주소:3000/#/administration` (관리자 권한 필요). 챌린지 진행 상태: `http://서버주소:3000/#/score-board`.

## 서비스 거부 챌린지만 비활성화

이 Compose 구성은 `JUICE_CHALLENGE_POLICY=non-dos`를 기본으로 사용합니다. Docker에서 제한되던 일반 챌린지를 활성화하고, 아래 5개는 스코어보드와 실행 경로에서 비활성화합니다.

- Blocked RCE DoS
- Successful RCE DoS
- NoSQL DoS
- XXE DoS
- Memory Bomb

XML·YAML 업로드는 일반 챌린지와 DoS 챌린지가 처리 경로를 공유하므로 별도 제한을 적용합니다. XML은 일반 문서와 64 KiB 이하의 로컬 일반 파일을 참조하는 `SYSTEM` 엔티티를 지원하며, 엔티티 중첩·외부 DTD·장치 파일은 거부합니다. 확장 후 XML 크기는 200,000바이트로 제한합니다. YAML은 일반 업로드를 허용하고, JSON 변환 시 노드 수와 문자열 크기를 제한해 별칭 확장에 의한 메모리 폭탄을 차단합니다. 다른 활성화된 취약점이나 대량 요청으로 발생할 수 있는 모든 서비스 장애를 방지하는 설정은 아닙니다.

공식 이미지의 파일을 수정하지 않고 [정책 시작 스크립트](runtime/challenge-policy.cjs)와 [업로드 제한](runtime/non-dos-uploads.cjs)을 읽기 전용으로 연결합니다. 이미지 업데이트 시 함께 확인해야 하는 호환성 계층입니다. 기본 안전 정책으로 돌아가려면 `.env`에서 `JUICE_CHALLENGE_POLICY=default`로 변경합니다. 이 정책은 `challenges.safetyMode: auto` 또는 `enabled`에서 사용하며, `disabled`와 함께 지정하면 시작을 거부합니다.

변경 적용은 `docker compose up -d`로 합니다. 컨테이너 재생성 시 DB·진행 상태가 초기화됩니다. DB 자동 판정 13종을 생략하는 `JUICE_DB_CHALLENGE_CHECKS=false`는 별도 설정입니다.
