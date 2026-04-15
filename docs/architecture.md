# 아키텍처

## 전체 구조

```
src/
├── cli/
│   ├── qmd.ts              # CLI 메인 라우터
│   ├── formatter.ts        # 출력 포맷 (JSON, CSV, XML, MD)
│   ├── ingest.ts           # 문서 등록
│   ├── extract.ts          # 지식 추출
│   ├── watch.ts            # 세션 감시 데몬
│   ├── rebuild.ts          # 볼트 기준 인덱스 재빌드
│   ├── graph.ts            # 그래프 CLI
│   ├── graph-obsidian.ts   # Obsidian 시각화 생성
│   └── wiki.ts             # 위키 CLI
├── store.ts                # 데이터 액세스 + 검색 파이프라인
├── index.ts                # SDK 진입점
├── db.ts                   # SQLite 크로스 런타임 호환
├── llm.ts                  # LLM 추상화 (node-llama-cpp)
├── ast.ts                  # tree-sitter AST 청킹/심볼 추출
├── graph.ts                # 그래프 관계 해석/클러스터링
├── korean.ts               # mecab-ko 형태소 분석
├── wiki.ts                 # 위키 CRUD + importance 추적
├── wikilinks.ts            # [[wiki-link]] 파싱
├── collections.ts          # YAML 컬렉션 설정
├── config/                 # hwicortex.yaml 로더
├── migration/              # DB 스키마 마이그레이션
├── ingest/                 # PDF 파서, 세션 파서, 파일 감시
└── knowledge/              # LLM 기반 지식 추출
```

## 검색 파이프라인

HwiCortex는 3가지 검색 모드를 제공한다.

| 모드 | 명령어 | 원리 |
|------|--------|------|
| 키워드 검색 | `search` | SQLite FTS5 BM25 |
| 벡터 검색 | `vsearch` | sqlite-vec 코사인 KNN |
| 하이브리드 검색 | `query` | BM25 + 벡터 + 쿼리 확장 + 리랭킹 |

### 하이브리드 검색 (`query`) 상세

```
사용자 쿼리
  │
  ▼
① 강한 신호 탐지
   BM25 프로브 (20건)
   1위 점수 >= 0.85 AND (1위 - 2위) >= 0.15 → 확장 스킵
  │
  ▼ (약한 신호)
② 쿼리 확장 (LLM)
   lex: 키워드 변형 (BM25용)
   vec: 의미 재표현 (벡터용)
   hyde: 가상 문서 (예상 답변)
  │
  ▼
③ 병렬 검색
   FTS: 원본 + lex 확장 쿼리 (각 20건)
   벡터: 모든 쿼리 배치 임베딩 → KNN (각 20건)
  │
  ▼
④ Reciprocal Rank Fusion (RRF)
   score = Σ(weight / (60 + rank + 1)) + 보너스
   원본 쿼리 결과 2배 가중
   1위: +0.05, 상위3: +0.02
  │
  ▼
⑤ 청크 선별
   상위 40개 문서의 최적 청크 선택
   쿼리 키워드 오버랩 기준 스코어링
  │
  ▼
⑥ LLM 리랭킹
   Qwen3-Reranker로 청크별 관련성 재산정
  │
  ▼
⑦ 블렌딩
   순위 1-3:  0.75 × RRF + 0.25 × 리랭크
   순위 4-10: 0.60 × RRF + 0.40 × 리랭크
   순위 11+:  0.40 × RRF + 0.60 × 리랭크
  │
  ▼
최종 결과 (중복 제거 + 정렬)
```

## 청킹

문서를 임베딩하기 전에 의미 단위로 분할한다.

### 파라미터

| 항목 | 값 |
|------|-----|
| 청크 크기 | 900 토큰 |
| 오버랩 | 135 토큰 (15%) |
| 탐색 윈도우 | ±200 토큰 |

### 분할 경계 점수

**마크다운:**

| 패턴 | 점수 |
|------|------|
| H1 (`# `) | 100 |
| H2 (`## `) | 90 |
| H3 / 코드블록 (`` ``` ``) | 80 |
| H4 | 70 |
| H5 / 수평선 (`---`) | 60 |
| H6 | 50 |
| 문단 구분 (`\n\n`) | 20 |
| 리스트 항목 | 5 |
| 줄바꿈 | 1 |

**AST (`--chunk-strategy auto`):**

| 패턴 | 점수 |
|------|------|
| class, interface, struct, module | 100 |
| function, method, export | 90 |
| type, enum | 80 |
| import | 60 |
| 기타 | 20 |

AST 청킹 지원 언어: TypeScript, JavaScript, Python, Go, Rust, C#

## 코드 그래프

tree-sitter AST 기반으로 심볼과 관계를 추출한다. `hwicortex update` 시 자동 실행.

### 관계 타입

| 타입 | 의미 |
|------|------|
| `imports` | 파일 import/require |
| `calls` | 함수/메서드 호출 |
| `extends` | 클래스/트레잇 상속 |
| `implements` | 인터페이스 구현 |
| `uses_type` | 타입 참조 |
| `wiki_link` | 마크다운 `[[링크]]` |

### 심볼 종류

`function`, `class`, `interface`, `type`, `enum`, `method`

### 경로 해석

import 경로를 실제 파일로 해석할 때 시도하는 확장자:
`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.cs`, `/index.ts`, `/index.js`

### 클러스터링

해석된 관계 그래프에서 연결 컴포넌트(DFS/BFS)를 찾아 모듈 클러스터를 자동 감지한다. `code`와 `doc` 두 종류로 구분.

## 한국어 검색

### 문제

SQLite FTS5의 기본 토크나이저(`porter unicode61`)는 공백/구두점 기준으로 토큰을 분리한다. 한국어는 교착어라서 "검색했다", "검색하는", "검색을"이 모두 다른 토큰으로 취급되어 "검색"으로 검색해도 매칭되지 않는다.

### 해결: mecab-ko 형태소 분석

인덱싱 시 한국어 텍스트를 mecab-ko로 형태소 분석하여 **내용 형태소**(content morphemes)만 추출한 뒤 FTS5에 저장한다.

```
원문:  "주문을 취소했다"
분석:  주문/NNG + 을/JKO + 취소/NNG + 했/XSV+EP + 다/EF
추출:  "주문 취소"  (NNG만 남김)
```

이렇게 하면 "주문", "취소" 어느 쪽으로 검색해도 매칭된다.

### 추출하는 품사 (CONTENT_POS)

| 태그 | 의미 | 예시 |
|------|------|------|
| NNG | 일반명사 | 검색, 주문, 인증 |
| NNP | 고유명사 | 서울, Claude |
| NNB | 의존명사 | 것, 수, 바 |
| VV | 동사 | 검색하다 → 검색 |
| VA | 형용사 | 빠르다 → 빠르 |
| MAG | 일반부사 | 매우, 아직 |
| XR | 어근 | 복합어의 어근 |

조사(JKS, JKO 등), 어미(EF, EC 등), 접미사(XSF) 등은 버린다.

### 동작 방식

1. 텍스트를 한글(U+AC00-U+D7AF)과 비한글 구간으로 분리 (`splitByScript`)
2. 한글 구간만 mecab 프로세스에 전달 (상주 프로세스, 5초 타임아웃)
3. mecab 출력에서 내용 형태소의 표면형만 추출 (`parseMecabOutput`)
4. 비한글 구간은 그대로 유지 (영문, 코드 등)
5. 결합하여 FTS5에 인덱싱

### 설치

```sh
# macOS
brew install mecab mecab-ko-dic

# Ubuntu
sudo apt install mecab libmecab-dev
# mecab-ko-dic 설치 (별도)
```

mecab이 없으면 자동으로 폴백 모드로 동작한다 (원문 그대로 인덱싱). 설치하면 다음 `hwicortex update` 시 자동으로 형태소 분석이 적용된다.

---

## 데이터베이스 스키마

SQLite 단일 파일 (`~/.cache/qmd/index.sqlite`).

### 핵심 테이블

| 테이블 | 역할 |
|--------|------|
| `content` | 콘텐츠 주소 저장소 (SHA256 해시 → 문서 텍스트) |
| `documents` | 파일 메타데이터 (컬렉션, 경로, 해시, active 플래그) |
| `documents_fts` | FTS5 가상 테이블 (porter unicode61 토크나이저) |
| `content_vectors` | 임베딩 메타데이터 (해시, 청크 순서, 모델) |
| `vectors_vec` | sqlite-vec 가상 테이블 (벡터 인덱스) |
| `store_collections` | 컬렉션 설정 |
| `llm_cache` | LLM 호출 결과 캐시 |

### 그래프 테이블

| 테이블 | 역할 |
|--------|------|
| `symbols` | 코드 심볼 (이름, 종류, 라인) |
| `relations` | 심볼/파일 관계 (source → target, 타입) |
| `clusters` | 모듈 클러스터 (컬렉션, 이름, 종류) |
| `cluster_members` | 클러스터 멤버십 (cluster_id → hash) |

## 사용 모델

모든 모델은 node-llama-cpp로 로컬 실행. 최초 사용 시 HuggingFace에서 자동 다운로드.

| 용도 | 모델 | 파라미터 | 양자화 |
|------|------|----------|--------|
| 임베딩 | EmbeddingGemma | 300M | Q8_0 |
| 리랭킹 | Qwen3-Reranker | 0.6B | Q8_0 |
| 쿼리 확장 | qmd-query-expansion (Qwen3 파인튜닝) | 1.7B | Q4_K_M |

모델 캐시: `~/.cache/qmd/models/`

## 설계 원칙

- **로컬 퍼스트**: 모든 LLM 추론과 검색이 로컬. 외부 API 불필요.
- **콘텐츠 주소 지정**: 해시 기반 중복 제거. 동일 내용은 한 번만 임베딩.
- **강한 신호 스킵**: BM25가 확신하면 LLM 확장을 건너뛴다.
- **크래시 안전**: SQLite 트랜잭션 + 삽입 순서로 중단 시 데이터 정합성 보장.
- **한국어**: mecab-ko 형태소 분석으로 활용형 매칭 ("검색" → "검색했다").
- **Obsidian이 진실의 원천**: SQLite는 파생 인덱스. 볼트가 원본.
