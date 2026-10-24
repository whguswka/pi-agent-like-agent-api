# 팀 표준 스킬 예 (모델 운영 저장소의 `.pi/skills/model-standard/SKILL.md`)

아래 내용을 저장소의 `.pi/skills/<이름>/SKILL.md` 로 둔다. 이 파일 자체는 스킬로 읽히지 않게 코드 블록으로 감쌌다.

````markdown
---
name: model-standard
description: model-lab 에서 새 모델을 만들거나 모델·공통함수를 고칠 때 사용. 표준 폴더·5단계·config 항목, 시험 방법, 운영 반영 절차.
---
# model-lab 모델 표준

자세한 표준은 저장소의 `docs/STANDARD.md`. 여기는 일할 때 확인할 것만.

## 새 모델
1. `models/<model_id>/` 에 `__init__.py`, `config.yaml`, `steps.py`, `pipeline.py` (비슷한 기존 모델을 복사해 고친다).
2. config 필수 항목을 모두 채운다 (`docs/STANDARD.md` 2장). 미국 모델은 `data_lag_days: 1`.
3. `steps.py` 의 5단계는 공통함수만 쓴다: 학습일 `dates.is_train_day`, 관리 테이블 `registry.*`, S3 `storage.*`.
4. 시험: `python -m models.<id>.steps all --base-date <영업일>` (개발 트리), `python -m models.<id>.pipeline compile`.
5. 관리 테이블 `model_registry` 에 등록할 내용과 정기 실행 등록은 사용자에게 알리고 승인 뒤에.

## 공통함수 변경
- 모든 호출부를 찾고(부르는 방식이 모델마다 다름), 모든 모델을 시험해 모델별 PASS·FAIL 표를 남긴다.
- 운영 트리(`~/work/model-lab-prod`)는 고치지 않는다. 반영은 승인 뒤 `tools/promote.sh`.
````
