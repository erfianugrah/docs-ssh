import json,sys,os,collections,urllib.parse
hosts=collections.Counter(); queries=[]; urls=collections.Counter()
def walk(o,src):
    if isinstance(o,dict):
        if o.get('type') in('toolCall','tool_use'):
            n=o.get('name',''); a=o.get('arguments') or o.get('input') or {}
            if isinstance(a,str):
                try:a=json.loads(a)
                except: a={}
            if not isinstance(a,dict): return
            u=a.get('url')
            if u and isinstance(u,str) and u.startswith('http') and ('fetch' in n.lower()):
                h=urllib.parse.urlparse(u).netloc.lower().removeprefix('www.'); hosts[h]+=1; urls[u]+=1
            q=a.get('query') or a.get('q')
            if q and n in('websearch','web_research','WebSearch','mcp__research__search_web','codesearch','search_web'):
                queries.append((n,q))
        for v in o.values(): walk(v,src)
    elif isinstance(o,list):
        for v in o: walk(v,src)
for path in sys.stdin:
    path=path.strip()
    try:
        for l in open(path,errors='replace'):
            if '"url"' not in l and '"query"' not in l: continue
            try: walk(json.loads(l),path)
            except: pass
    except: pass
json.dump({'hosts':hosts.most_common(),'urls':urls.most_common(),'queries':queries},open('webuse.json','w'))
print(len(hosts),sum(hosts.values()),len(queries))
