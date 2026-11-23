"""Read originals without changing them; preserve locators, formulas and page boundaries."""
from pathlib import Path
import json, hashlib, struct, zipfile, xml.etree.ElementTree as ET, io, re
from pypdf import PdfReader
from openpyxl import load_workbook
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reference-review';OUT.mkdir(exist_ok=True)
def u16(b,p):return struct.unpack_from('<H',b,p)[0]
def u32(b,p):return struct.unpack_from('<I',b,p)[0]
def old_doc(raw):
    size=1<<u16(raw,30); mini_size=1<<u16(raw,32)
    sec=lambda n:raw[(n+1)*size:(n+2)*size]
    dif=list(struct.unpack_from('<109I',raw,76)); nxt=u32(raw,68)
    for _ in range(u32(raw,72)):
        z=sec(nxt); dif.extend(struct.unpack('<%dI'%(size//4-1),z[:-4]));nxt=u32(z,size-4)
    fat=[]
    for n in dif:
        if n<0xfffffffa:fat.extend(struct.unpack('<%dI'%(size//4),sec(n)))
    def chain(n,table,reader):
        result=[];seen=set()
        while n<0xfffffffa:
            if n in seen or n>=len(table):raise ValueError('Invalid compound-file chain')
            seen.add(n);result.append(reader(n));n=table[n]
        return b''.join(result)
    directory=chain(u32(raw,48),fat,sec); entries={};root=None
    for pos in range(0,len(directory),128):
        e=directory[pos:pos+128]; ln=u16(e,64)
        if ln<2:continue
        name=e[:ln-2].decode('utf-16le'); rec=(u32(e,116),struct.unpack_from('<Q',e,120)[0]);entries[name]=rec
        if e[66]==5:root=rec
    mini=chain(root[0],fat,sec)[:root[1]]
    mf=chain(u32(raw,60),fat,sec) if u32(raw,64) else b''
    minifat=list(struct.unpack('<%dI'%(len(mf)//4),mf))
    def stream(name):
        n,ln=entries[name]
        return (chain(n,minifat,lambda i:mini[i*mini_size:(i+1)*mini_size]) if ln<u32(raw,56) else chain(n,fat,sec))[:ln]
    word=stream('WordDocument');flags=u16(word,10)
    if flags&0x100:raise ValueError('Encrypted Word document')
    table=stream('1Table' if flags&0x200 else '0Table')
    p=32;p+=2+u16(word,p)*2;p+=2+u16(word,p)*4
    pairs=u16(word,p);p+=2
    if pairs<=33:raise ValueError('Older DOC FIB not supported')
    fc,lcb=struct.unpack_from('<II',word,p+33*8);clx=table[fc:fc+lcb];p=0
    while clx[p]==1:p+=3+u16(clx,p+1)
    if clx[p]!=2:raise ValueError('Missing piece table')
    ln=u32(clx,p+1);plc=clx[p+5:p+5+ln];n=(ln-4)//12;cp=struct.unpack_from('<%dI'%(n+1),plc,0);text=[]
    for i in range(n):
        fc=u32(plc,(n+1)*4+i*8+2);compressed=bool(fc&0x40000000);off=fc&0x3fffffff;count=cp[i+1]-cp[i]
        if compressed:off//=2;text.append(word[off:off+count].decode('cp874' if u16(word,6)==0x041e else 'cp1252',errors='replace'))
        else:text.append(word[off:off+count*2].decode('utf-16le',errors='replace'))
    return ''.join(text).replace('\r','\n').replace('\x07','\t')

manifest=[]
for number,path in enumerate(sorted((ROOT/'references').iterdir()),1):
    if not path.is_file():continue
    raw=path.read_bytes();row={'id':f'R{number:02}', 'name':path.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};data={};lines=[]
    try:
        if raw.startswith(b'%PDF'):
            row['format']='pdf';reader=PdfReader(io.BytesIO(raw));data['pages']=[];row['pages']=len(reader.pages)
            for i,page in enumerate(reader.pages,1):
                text=page.extract_text() or '';data['pages'].append({'page':i,'text':text});lines.append(f'\n=== PAGE {i} ===\n{text}')
            row['lowTextPages']=[p['page'] for p in data['pages'] if len(re.sub(r'\s','',p['text']))<30]
        elif raw.startswith(b'PK'):
            z=zipfile.ZipFile(io.BytesIO(raw))
            if 'xl/workbook.xml' in z.namelist():
                row['format']='xlsx';wb=load_workbook(io.BytesIO(raw),read_only=False,data_only=False);cached=load_workbook(io.BytesIO(raw),read_only=False,data_only=True);data['sheets']=[]
                for ws in wb:
                    cells=[];lines.append(f'\n=== SHEET {ws.title} {ws.max_row}x{ws.max_column} ===')
                    for values in ws:
                        rowtext=[]
                        for c in values:
                            if c.value is None:continue
                            val=str(c.value) if not isinstance(c.value,(int,float,str,bool)) else c.value
                            cell={'cell':c.coordinate,'value':val}
                            if c.data_type=='f':cell['cached']=cached[ws.title][c.coordinate].value
                            cells.append(cell);rowtext.append(f'{c.coordinate}: {val}'+(f' [cached={cell["cached"]}]' if c.data_type=='f' else ''))
                        if rowtext:lines.append(' | '.join(rowtext))
                    data['sheets'].append({'name':ws.title,'rows':ws.max_row,'columns':ws.max_column,'merged':[str(r) for r in ws.merged_cells.ranges],'cells':cells})
                row['sheets']=[s['name'] for s in data['sheets']]
            elif 'word/document.xml' in z.namelist():
                row['format']='docx';ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};parts=[]
                for name in z.namelist():
                    if re.match(r'word/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$',name):
                        root=ET.fromstring(z.read(name));pars=[]
                        for p in root.findall('.//w:p',ns):pars.append(''.join(t.text or '' for t in p.findall('.//w:t',ns)))
                        text='\n'.join(pars);parts.append({'part':name,'text':text});lines.append(f'=== {name} ===\n{text}')
                data['parts']=parts
            else:raise ValueError('Unknown ZIP document format')
        elif raw.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
            row['format']='doc';data['text']=old_doc(raw);lines.append(data['text']);row['limitation']='Extracted Word main-story text; pagination/layout not rendered'
        elif raw.startswith(b'\x89PNG'):
            row['format']='png';im=Image.open(io.BytesIO(raw));row['dimensions']=im.size;row['status']='requires_visual_review';lines=['Image: visual review required']
        else:
            row['format']='text';data['text']=raw.decode('utf-8-sig');lines.append(data['text'])
        row.setdefault('status','extracted');text='\n'.join(lines);row['characters']=len(text)
        (OUT/(row['id']+'.txt')).write_text(text,encoding='utf-8');(OUT/(row['id']+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    except Exception as e:row['status']='error';row['error']=f'{type(e).__name__}: {e}'
    manifest.append(row);print(json.dumps(row,ensure_ascii=False))
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
