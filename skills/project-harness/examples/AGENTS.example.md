# AGENTS.md 예 (모델 운영 저장소 맨 위의 `AGENTS.md`)

````markdown
# model-lab 지침

분석모델 12개를 같은 표준(5단계)과 공통함수로 운영하는 저장소다. 표준은 `docs/STANDARD.md`.

## 트리
- 개발 트리: `~/work/model-lab` (이 폴더). 고치고 시험하는 곳.
- 운영 트리: `~/work/model-lab-prod`. KFP 정기 실행이 쓰는 코드다. **읽기만 하고 고치지 않는다.**
- 운영 반영은 사용자 승인 뒤 `tools/promote.sh --approved-by <이름>` 로만 한다.

## 실행 환경
- Kubeflow 노트북, Python 3.11. 시장 데이터는 `stock_analytics`(읽기만), 결과·관리 테이블은 `pi_agent`.
- 관리 테이블: `model_registry`(모델 목록·마지막 학습일), `model_run`(실행 기록: status RUNNING·SUCCEEDED·FAILED·SKIPPED, failed_step, message, env dev·prod).
- 예측 결과: `model_prediction`. S3: `mlpipeline` 버킷의 `private-artifacts/pi-agent/model-lab/<env>/` 아래 (raw·model).
- KFP: `common.pipeline.client()` (네임스페이스 `pi-agent`, 실험 `model-lab`).

## 규칙
- 시험 실행은 개발 트리에서 (dev 영역을 씀). 운영 영역(env=prod) 데이터·기록은 고치지 않는다.
- 관리 테이블은 `common.registry` 로만 쓴다. S3 삭제는 모델의 raw 경로만.
- 공통함수를 바꾸면 표준 5장 절차를 따른다 (모든 모델 시험 결과 표).
- 실패 원인을 물으면 관리 테이블의 메시지에서 멈추지 말고 코드(함수 정의와 호출부)를 읽어, 원인 위치(파일·줄)와 다른 모델 영향을 함께 답한다.
- 운영을 바로 고쳐 달라는 요청은 거절만 하지 말고, 개발 트리에서 고치고 시험해 둔 뒤 반영 승인을 묻는다.
````
