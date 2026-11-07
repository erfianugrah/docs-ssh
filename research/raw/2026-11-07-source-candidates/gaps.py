import json,bisect,re,collections
rows=open('index.tsv',encoding='utf-8',errors='replace').read().lower().split('\n')
text='\n'.join(rows); starts=[];o=0
for r in rows: starts.append(o); o+=len(r)+1
src=[r.split('/')[0] for r in rows]
cache={}
def hits(t):
    if t not in cache:
        s=set(); i=text.find(t)
        while i!=-1:
            k=bisect.bisect_right(starts,i)-1; s.add(k); i=text.find(t, starts[k]+len(rows[k])+1) if k+1<len(starts) else -1
        cache[t]=s
    return cache[t]
qs=collections.Counter()
for l in open('qlog.jsonl'):
    d=json.loads(l)
    if d.get('op')!='search' or d.get('type')=='exec.done': continue
    qs[(d.get('q','').strip().lower(), d.get('source') or '')]+=1
out=[]
for (q,s),n in qs.items():
    toks=[t for t in re.split(r'\s+',q) if t]
    if not toks: continue
    c=collections.Counter()
    for t in toks:
        for k in hits(t):
            if not s or src[k]==s: c[k]+=1
    best=max(c.values()) if c else 0
    out.append((best/len(toks),best,len(toks),n,s,q))
out.sort()
for r in out:
    if r[0]<0.75: print(f"{r[1]}/{r[2]}\tx{r[3]}\t{r[4]}\t{r[5]}")
