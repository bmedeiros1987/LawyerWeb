"""Check text from the actual LibreOffice PDF conversion; synthetic CI artifacts only."""
from pathlib import Path
text = Path("artifacts/pilot-e2e/libreoffice/documento-v3.txt").read_text()
for expected in ["DOCUMENTO SINTÉTICO", "Pessoa Fictícia & Companhia", "<literal>", "versão três", "SHA-256"]:
    if expected not in text:
        raise SystemExit(f"LibreOffice conversion did not preserve synthetic marker: {expected}")
print("PASS: LibreOffice-rendered DOCX preserves Portuguese, literal markup, latest version and provenance")
