# 설정

## 파일 위치

| 파일 | 경로 | 설명 |
|------|------|------|
| SQLite 인덱스 | `~/.cache/qmd/index.sqlite` | 검색 인덱스 DB |
| LLM 모델 캐시 | `~/.cache/qmd/models/` | GGUF 모델 파일 |
| QMD 설정 | `~/.config/qmd/index.yml` | 컬렉션 설정 (YAML) |
| 프로젝트 설정 | `./hwicortex.yaml` | 지식 추출/세션 감시 설정 |
| 위키 저장소 | `vault/wiki/{project}/` | Obsidian 호환 마크다운 |
| CLI 바이너리 | `which hwicortex` | `bun link`가 생성한 심볼릭 링크 |

## 환경변수

### 경로

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `INDEX_PATH` | DB 경로 오버라이드 | `~/.cache/qmd/index.sqlite` |
| `QMD_VAULT_DIR` | 위키 볼트 디렉토리 | 없음 (위키 사용 시 필수) |
| `QMD_CONFIG_DIR` | 설정 디렉토리 오버라이드 | `~/.config/qmd` |
| `XDG_CACHE_HOME` | 캐시 루트 | `~/.cache` |
| `XDG_CONFIG_HOME` | 설정 루트 | `~/.config` |

위키 기능 사용 시 `QMD_VAULT_DIR` 설정이 필요하다:

```sh
# ~/.zshrc 또는 ~/.bashrc에 추가
export QMD_VAULT_DIR=~/my-obsidian-vault

# 또는 명령어마다 플래그
hwicortex wiki list --vault-dir ~/my-obsidian-vault
```

### 모델

| 변수 | 설명 | 기본 모델 |
|------|------|-----------|
| `QMD_EMBED_MODEL` | 임베딩 모델 URI | EmbeddingGemma 300M Q8_0 |
| `QMD_RERANK_MODEL` | 리랭킹 모델 URI | Qwen3-Reranker 0.6B Q8_0 |
| `QMD_GENERATE_MODEL` | 쿼리 확장 모델 URI | qmd-query-expansion 1.7B Q4_K_M |
| `QMD_EMBED_CONTEXT_SIZE` | 임베딩 컨텍스트 크기 | 모델 기본값 |
| `QMD_RERANK_CONTEXT_SIZE` | 리랭킹 컨텍스트 크기 | 모델 기본값 |
| `QMD_EXPAND_CONTEXT_SIZE` | 쿼리 확장 컨텍스트 크기 | 모델 기본값 |
| `QMD_LLAMA_GPU` | GPU 설정 (`metal`, `cuda`, `cpu`) | 자동 감지 |

### 기타

| 변수 | 설명 |
|------|------|
| `QMD_EDITOR_URI` | 에디터 URI 템플릿 (기본: `vscode://file/{path}:{line}:{col}`) |
| `ANTHROPIC_API_KEY` | Claude API 키 (지식 추출 시 필요) |
| `NO_COLOR` | 터미널 컬러 비활성화 |

## hwicortex.yaml

지식 추출과 세션 감시를 위한 프로젝트별 설정. 프로젝트 루트에 위치한다.

```yaml
# 볼트 경로
vault:
  path: ~/hwicortex-vault

# 세션 감시
sessions:
  watch_dirs:
    - ~/.claude/projects        # Claude Code 세션
    - ~/.codex/sessions         # Codex CLI 세션
  idle_timeout_minutes: 10      # 세션 종료 판정 기준 (분)

# LLM 설정
llm:
  default: claude               # claude | local
  claude:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-6
  local:
    model_path: ~/.hwicortex/models/default.gguf
  budget:
    max_tokens_per_run: 500000  # extract 1회당 토큰 상한
    warn_threshold: 100000      # 이 이상이면 확인 프롬프트

# 문서 컬렉션 (ingest용)
ingest:
  collections:
    - name: "요구사항"
      path: ~/projects/specs
      pattern: "*.md,*.pdf"
```

`${ENV_VAR}` 형식으로 환경변수를 참조할 수 있다.

## 볼트 구조

```
vault/
├── docs/                    # 등록 문서 (ingest)
│   └── {name}/
├── sessions/                # 파싱된 세션 로그
│   └── {project}/
├── knowledge/               # 추출된 지식
│   └── {project}/
├── wiki/                    # 위키 페이지
│   └── {project}/
│       └── {title}.md       # frontmatter에 importance, hit_count 포함
└── .obsidian/               # Obsidian 설정 (HwiCortex 수정 안 함)
```

Obsidian 볼트가 진실의 원천이고, SQLite 인덱스는 파생 데이터다. HwiCortex는 `.obsidian/` 디렉토리를 수정하지 않는다.
