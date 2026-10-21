#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <objbase.h>
#include <shlobj.h>
#include <stdio.h>
DEFINE_GUID(CLSID_MakanOpen, 0x7c1b5e2a, 0x3f4d, 0x4a8b, 0x9e, 0x21, 0x6d, 0x0a, 0x5b, 0x7c, 0x9f, 0x13);
typedef struct { IDataObject i; LONG ref; HGLOBAL h; } DO;
static HRESULT STDMETHODCALLTYPE qi(IDataObject*s,REFIID r,void**p){ if(IsEqualIID(r,&IID_IUnknown)||IsEqualIID(r,&IID_IDataObject)){*p=s;return S_OK;} *p=NULL; return E_NOINTERFACE; }
static ULONG STDMETHODCALLTYPE ar(IDataObject*s){return 2;}
static HRESULT STDMETHODCALLTYPE gd(IDataObject*s,FORMATETC*f,STGMEDIUM*m){ DO*d=(DO*)s; if(f->cfFormat!=CF_HDROP) return DV_E_FORMATETC; SIZE_T n=GlobalSize(d->h); HGLOBAL c=GlobalAlloc(GMEM_MOVEABLE,n); memcpy(GlobalLock(c),GlobalLock(d->h),n); GlobalUnlock(c); GlobalUnlock(d->h); m->tymed=TYMED_HGLOBAL; m->hGlobal=c; m->pUnkForRelease=NULL; return S_OK; }
static HRESULT STDMETHODCALLTYPE nope(){return E_NOTIMPL;}
static IDataObjectVtbl vt={qi,ar,ar,gd,(void*)nope,(void*)nope,(void*)nope,(void*)nope,(void*)nope,(void*)nope,(void*)nope,(void*)nope};
int main(int argc,char**argv){
  CoInitialize(NULL);
  HMODULE m=LoadLibraryW(L"makan-open.dll"); if(!m){printf("load fail\n");return 1;}
  HRESULT (WINAPI*gco)(REFCLSID,REFIID,void**)=(void*)GetProcAddress(m,"DllGetClassObject");
  IClassFactory*cf=NULL; if(FAILED(gco(&CLSID_MakanOpen,&IID_IClassFactory,(void**)&cf))){printf("factory fail\n");return 2;}
  IDropTarget*dt=NULL; if(FAILED(IClassFactory_CreateInstance(cf,NULL,&IID_IDropTarget,(void**)&dt))){printf("create fail\n");return 3;}
  /* DROPFILES with N wide paths (read from argv, UTF-8 -> wide) */
  wchar_t buf[200000]; int pos=0;
  { const wchar_t*u=L"C:\\Music\\\u06a9\u0627\u0648\u0647 \u00dcn\u00ef.mp3"; int n=lstrlenW(u)+1; memcpy(buf+pos,u,n*2); pos+=n; }
  for(int i=1;i<argc;i++){ int n=MultiByteToWideChar(CP_UTF8,0,argv[i],-1,buf+pos,20000); pos+=n; }
  buf[pos++]=0;
  SIZE_T sz=sizeof(DROPFILES)+pos*sizeof(wchar_t);
  HGLOBAL h=GlobalAlloc(GMEM_MOVEABLE|GMEM_ZEROINIT,sz); DROPFILES*df=GlobalLock(h); df->pFiles=sizeof(DROPFILES); df->fWide=TRUE; memcpy((char*)df+sizeof(DROPFILES),buf,pos*sizeof(wchar_t)); GlobalUnlock(h);
  DO d={{&vt},1,h};
  DWORD eff=DROPEFFECT_COPY; POINTL pt={0,0};
  HRESULT hr=IDropTarget_Drop(dt,&d.i,0,pt,&eff);
  printf("drop hr=%lx effect=%lu\n",(unsigned long)hr,(unsigned long)eff);
  IDropTarget_Release(dt);
  printf("canunload=%ld\n",(long)((HRESULT(WINAPI*)(void))GetProcAddress(m,"DllCanUnloadNow"))());
  return 0; }
