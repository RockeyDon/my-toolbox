.PHONY: dev check test-unit test-e2e build package

dev:
	pnpm tauri dev

check:
	pnpm check
	cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

test-unit:
	pnpm test
	cargo test --manifest-path src-tauri/Cargo.toml

test-e2e:
	pnpm test:e2e

build:
	pnpm tauri build

package:
	pnpm tauri build --bundles app,dmg
