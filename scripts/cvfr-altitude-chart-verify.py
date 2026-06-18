#!/usr/bin/env python3
"""Cross-check docs/data/leg-altitude.json directional altitudes against the
official IAA CVFR chart PDFs (North 2025 + South 2023).

The charts are vector PDFs: every yellow CVFR altitude arrow is a magnetic
radial (3-digit) next to an altitude (3-4 digit) in the text layer, and the
graticule lat/lng tick labels give a precise pixel<->geo transform. For each
segment we compute both directional bearings + the leg pixel line, then read
the altitude of the nearest arrow whose radial matches that direction.

Output: a review CSV (from,to,direction,json_alt,chart_alt,verdict). This is a
TRIAGE aid, not ground truth — sparse desert legs can mis-pair a stray token
(watch for spurious low values). Confirm flagged rows visually before editing
altitude data.

Usage: python3 scripts/cvfr-altitude-chart-verify.py [--out review.csv]
Requires: poppler (pdftotext), network access to gov.il for the PDFs.
"""
import re, math, json, os, sys, subprocess, urllib.request, csv

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA=os.path.join(ROOT,"docs","data")
CACHE="/tmp"
UA="Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

def fetch(url,dest):
    if os.path.exists(dest) and os.path.getsize(dest)>1e6: return dest
    req=urllib.request.Request(url,headers={"User-Agent":UA})
    with urllib.request.urlopen(req,timeout=60) as r, open(dest,"wb") as f: f.write(r.read())
    return dest

def bbox(pdf):
    out=pdf.replace(".pdf","_bbox.html")
    subprocess.run(["pdftotext","-bbox","-enc","UTF-8",pdf,out],check=True)
    return open(out,encoding="utf-8").read()

ALTS={500,800,1000,1200,1500,1600,1800,2000,2200,2300,2500,2800,3000,3300,3500,4000,4500,5000,5500,6000,6500,7000}

def load_chart(html):
    W=[(float(a),float(b),float(c),float(d),e) for a,b,c,d,e in
       re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',html)]
    cx=lambda w:(w[0]+w[2])/2; cy=lambda w:(w[1]+w[3])/2
    def fit(P):
        n=len(P);sx=sum(p[0] for p in P);sy=sum(p[1] for p in P)
        sxx=sum(p[0]**2 for p in P);sxy=sum(p[0]*p[1] for p in P)
        a=(n*sxy-sx*sy)/(n*sxx-sx*sx);return a,(sy-a*sx)/n
    latp=[];lngp=[]
    for w in W:
        m=re.match(r"(\d+)°(\d+)&apos;N",w[4])
        if m and w[0]>1850: latp.append((cy(w),int(m.group(1))+int(m.group(2))/60))
        m=re.match(r"(\d+)°(\d+)&apos;E",w[4])
        if m and cy(w)>2700: lngp.append((cx(w),int(m.group(1))+int(m.group(2))/60))
    aLat,bLat=fit(latp); aLng,bLng=fit(lngp)
    al=[];rd=[]
    for w in W:
        t=w[4]
        if re.fullmatch(r'\d{3,4}',t):
            v=int(t)
            if v in ALTS: al.append((cx(w),cy(w),v))
            if 0<=v<=359 and len(t)==3: rd.append((cx(w),cy(w),v))
    arr=[]
    for ax,ay,av in al:
        b=min(rd,key=lambda r:math.hypot(ax-r[0],ay-r[1]),default=None)
        if b and math.hypot(ax-b[0],ay-b[1])<45: arr.append((ax,ay,av,b[2]))
    return dict(aLat=aLat,bLat=bLat,aLng=aLng,bLng=bLng,arrows=arr,
                latlo=min(p[1] for p in latp),lathi=max(p[1] for p in latp))

def toxy(ch,lat,lng): return ((lng-ch['bLng'])/ch['aLng'],(lat-ch['bLat'])/ch['aLat'])
def bearing(a,b):
    la1,lo1,la2,lo2=map(math.radians,[a[0],a[1],b[0],b[1]])
    y=math.sin(lo2-lo1)*math.cos(la2);x=math.cos(la1)*math.sin(la2)-math.sin(la1)*math.cos(la2)*math.cos(lo2-lo1)
    return (math.degrees(math.atan2(y,x))-5)%360  # magnetic, var ~5E
def angd(a,b): return abs((a-b+180)%360-180)
def segd(px,py,x1,y1,x2,y2):
    dx,dy=x2-x1,y2-y1;L=dx*dx+dy*dy
    if L==0:return math.hypot(px-x1,py-y1)
    t=max(0,min(1,((px-x1)*dx+(py-y1)*dy)/L));return math.hypot(px-(x1+t*dx),py-(y1+t*dy))

def main():
    out="review.csv"
    if "--out" in sys.argv: out=sys.argv[sys.argv.index("--out")+1]
    d=json.load(open(os.path.join(DATA,"leg-altitude.json")))
    charts={c["id"]:c for c in d["sourceCharts"]}
    Np=fetch(charts["north"]["url"],os.path.join(CACHE,"cvfr_north.pdf"))
    Sp=fetch(charts["south"]["url"],os.path.join(CACHE,"cvfr_south.pdf"))
    N=load_chart(bbox(Np)); S=load_chart(bbox(Sp))
    nav={w['name']:(w['lat'],w['lng']) for w in json.load(open(os.path.join(DATA,"nav-waypoints.json")))['waypoints']}
    af={a['name']:(a['lat'],a['lng']) for a in json.load(open(os.path.join(DATA,"airfields.json")))['airfields']}
    C={**nav,**af}
    pick=lambda lat: N if lat>=31.15 else S
    def diralt(frm,to):
        if frm not in C or to not in C: return None
        mid=((C[frm][0]+C[to][0])/2,(C[frm][1]+C[to][1])/2); ch=pick(mid[0])
        p1=toxy(ch,*C[frm]);p2=toxy(ch,*C[to]);brg=bearing(C[frm],C[to]);best=None
        for ax,ay,av,ar in ch['arrows']:
            dd=segd(ax,ay,p1[0],p1[1],p2[0],p2[1])
            if dd<60 and angd(ar,brg)<20 and (best is None or dd<best[1]): best=(av,dd)
        return best[0] if best else None
    rows=[]
    for s in d['segments']:
        frm,to=s['from'],s['to']; ci=diralt(frm,to); co=diralt(to,frm)
        for dirn,j,c in [(f"{frm}->{to}",s['inboundAltitude'],ci),(f"{to}->{frm}",s['outboundAltitude'],co)]:
            if c is None: v="unmatched"
            elif c==j: v="confirm"
            elif ci is not None and co is not None and ci==co: v="ambig-double-match"
            else: v="MISMATCH"
            rows.append([frm,to,dirn,j,c,v])
    with open(out,"w",newline="") as f:
        w=csv.writer(f);w.writerow(["from","to","direction","json_alt","chart_alt","verdict"]);w.writerows(rows)
    from collections import Counter
    print("verdicts:",dict(Counter(r[5] for r in rows)),"-> ",out)

if __name__=="__main__": main()
