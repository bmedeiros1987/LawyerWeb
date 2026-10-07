# Validates that the read-only textual preview is exactly the generated file
# content. This is fixture validation, not a general DOCX/PDF fidelity parser.
import json,pathlib,hashlib,zipfile,xml.etree.ElementTree as ET,re
root=pathlib.Path.cwd()
source=(root/'lib/document-review/fixtures.ts').read_text()
fixtures=json.loads(source.split('export const fixtures: Fixture[] = ',1)[1].rsplit(';',1)[0])
for f in fixtures:
 file=root/'public'/f['file'].lstrip('/');data=file.read_bytes()
 assert hashlib.sha256(data).hexdigest()==f['fileSha256']
 expected=[c['text'] for c in f['clauses']]
 if f['format']=='DOCX':
  with zipfile.ZipFile(file) as z:
   assert z.testzip() is None
   assert set(z.namelist())=={'[Content_Types].xml','_rels/.rels','word/document.xml'}
   document=ET.fromstring(z.read('word/document.xml'))
   paragraphs=[''.join(p.itertext()) for p in document.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')]
   assert paragraphs==expected
 else:
  assert data.startswith(b'%PDF-1.4')
  text=data.decode('cp1252');paragraphs=re.findall(r'\(([^()]*)\) Tj',text)
  assert paragraphs==expected
  assert '/JavaScript' not in text and '/Launch' not in text and '/URI' not in text
 print('PASS:',f['id'],f['format'],'bytes SHA256 and fixture text match')
