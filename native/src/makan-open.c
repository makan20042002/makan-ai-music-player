/*
 * makan-open.c - MAKAN Music Player "Open with" helper for Windows Explorer.
 *
 * Explorer cannot pass thousands of selected files to a program on its command line (about 32,000
 * characters at most), and it starts one copy of the program per file for a normal "open" verb.
 * Windows Media Player avoids this with a DropTarget: Explorer gives the whole selection to a COM
 * object. This DLL is that COM object for MAKAN.
 *
 *   Explorer  --(IDropTarget::Drop, all selected files/folders)-->  makan-open.dll
 *   makan-open.dll writes the full paths, one per line (UTF-8), into a small list file in %TEMP%
 *   and starts:  "<MAKAN exe>" --open-list "<list file>"
 *   (if MAKAN is already running, the single-instance code of the app forwards the list to it).
 *
 * (Tests set the environment variable MAKAN_OPEN_EXE to a stand-in program instead.)
 * The installer registers this DLL under HKCU\Software\Classes\CLSID\{7C1B5E2A-3F4D-4A8B-9E21-6D0A5B7C9F13}
 * and writes the path of the MAKAN exe to HKCU\Software\MAKAN\MusicPlayer, value "ExePath".
 * The DLL reads nothing else and talks to nothing else. Build: scripts/build-native-helper.js
 */
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <objbase.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <stdio.h>
#include <wchar.h>

/* {7C1B5E2A-3F4D-4A8B-9E21-6D0A5B7C9F13} */
DEFINE_GUID(CLSID_MakanOpen, 0x7c1b5e2a, 0x3f4d, 0x4a8b, 0x9e, 0x21, 0x6d, 0x0a, 0x5b, 0x7c, 0x9f, 0x13);

static LONG g_objects = 0;
static LONG g_locks = 0;

/* ---------- writing the list ---------- */

static int write_line(HANDLE f, const wchar_t *w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, NULL, 0, NULL, NULL);
  if (n <= 1) return 0;
  char *u = (char *)HeapAlloc(GetProcessHeap(), 0, (SIZE_T)n + 1);
  if (!u) return 0;
  WideCharToMultiByte(CP_UTF8, 0, w, -1, u, n, NULL, NULL);
  u[n - 1] = '\n';
  DWORD wrote = 0;
  BOOL ok = WriteFile(f, u, (DWORD)n, &wrote, NULL);
  HeapFree(GetProcessHeap(), 0, u);
  return ok ? 1 : 0;
}

/* all paths of the selection into the list file; returns how many were written */
static UINT write_selection(IDataObject *obj, HANDLE f) {
  UINT count = 0;
  FORMATETC fe;
  STGMEDIUM sm;
  ZeroMemory(&fe, sizeof(fe));
  ZeroMemory(&sm, sizeof(sm));
  fe.cfFormat = CF_HDROP;
  fe.dwAspect = DVASPECT_CONTENT;
  fe.lindex = -1;
  fe.tymed = TYMED_HGLOBAL;
  if (SUCCEEDED(IDataObject_GetData(obj, &fe, &sm))) {
    HDROP h = (HDROP)GlobalLock(sm.hGlobal);
    if (h) {
      UINT n = DragQueryFileW(h, 0xFFFFFFFF, NULL, 0);
      UINT i;
      for (i = 0; i < n; i++) {
        UINT len = DragQueryFileW(h, i, NULL, 0);
        wchar_t *buf = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, ((SIZE_T)len + 2) * sizeof(wchar_t));
        if (!buf) continue;
        if (DragQueryFileW(h, i, buf, len + 1) && write_line(f, buf)) count++;
        HeapFree(GetProcessHeap(), 0, buf);
      }
      GlobalUnlock(sm.hGlobal);
    }
    ReleaseStgMedium(&sm);
    if (count) return count;
  }
  /* some sources give only a shell item list: ask the shell for the file system paths */
  {
    IShellItemArray *arr = NULL;
    if (SUCCEEDED(SHCreateShellItemArrayFromDataObject(obj, &IID_IShellItemArray, (void **)&arr)) && arr) {
      DWORD n = 0, i;
      if (SUCCEEDED(IShellItemArray_GetCount(arr, &n))) {
        for (i = 0; i < n; i++) {
          IShellItem *it = NULL;
          if (SUCCEEDED(IShellItemArray_GetItemAt(arr, i, &it)) && it) {
            PWSTR p = NULL;
            if (SUCCEEDED(IShellItem_GetDisplayName(it, SIGDN_FILESYSPATH, &p)) && p) {
              if (write_line(f, p)) count++;
              CoTaskMemFree(p);
            }
            IShellItem_Release(it);
          }
        }
      }
      IShellItemArray_Release(arr);
    }
  }
  return count;
}

/* the MAKAN exe, written by the installer */
static int read_exe_path(wchar_t *out, DWORD chars) {
  DWORD bytes = chars * (DWORD)sizeof(wchar_t);
  /* tests can name a stand-in program here instead of using the installer's registry value */
  DWORD got = GetEnvironmentVariableW(L"MAKAN_OPEN_EXE", out, chars);
  if (got > 0 && got < chars) return 1;
  LONG r = RegGetValueW(HKEY_CURRENT_USER, L"Software\\MAKAN\\MusicPlayer", L"ExePath", RRF_RT_REG_SZ, NULL, out, &bytes);
  return r == ERROR_SUCCESS && out[0] != 0;
}

static void open_selection(IDataObject *obj) {
  wchar_t tmp[MAX_PATH + 1], list[MAX_PATH + 64], exe[MAX_PATH + 1];
  HANDLE f;
  UINT n;
  if (!obj) return;
  if (!read_exe_path(exe, MAX_PATH)) return;
  if (!GetTempPathW(MAX_PATH, tmp)) return;
  _snwprintf(list, MAX_PATH + 63, L"%smakan-open-%lu-%lu.lst", tmp, GetCurrentProcessId(), GetTickCount());
  list[MAX_PATH + 63] = 0;
  f = CreateFileW(list, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) return;
  n = write_selection(obj, f);
  CloseHandle(f);
  if (!n) { DeleteFileW(list); return; }
  {
    wchar_t cmd[2 * MAX_PATH + 128];
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    _snwprintf(cmd, 2 * MAX_PATH + 127, L"\"%ls\" --open-list \"%ls\"", exe, list);
    cmd[2 * MAX_PATH + 127] = 0;
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
    } else {
      DeleteFileW(list);
    }
  }
}

/* ---------- the drop target ---------- */

typedef struct MakanDrop {
  IDropTarget iface;
  LONG ref;
} MakanDrop;

static HRESULT STDMETHODCALLTYPE dt_QueryInterface(IDropTarget *self, REFIID riid, void **ppv) {
  if (!ppv) return E_POINTER;
  if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_IDropTarget)) {
    *ppv = self;
    IDropTarget_AddRef(self);
    return S_OK;
  }
  *ppv = NULL;
  return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE dt_AddRef(IDropTarget *self) {
  return (ULONG)InterlockedIncrement(&((MakanDrop *)self)->ref);
}
static ULONG STDMETHODCALLTYPE dt_Release(IDropTarget *self) {
  MakanDrop *d = (MakanDrop *)self;
  LONG r = InterlockedDecrement(&d->ref);
  if (r == 0) {
    HeapFree(GetProcessHeap(), 0, d);
    InterlockedDecrement(&g_objects);
  }
  return (ULONG)r;
}
static HRESULT STDMETHODCALLTYPE dt_DragEnter(IDropTarget *self, IDataObject *obj, DWORD keys, POINTL pt, DWORD *effect) {
  (void)self; (void)obj; (void)keys; (void)pt;
  if (effect) *effect = DROPEFFECT_COPY;
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE dt_DragOver(IDropTarget *self, DWORD keys, POINTL pt, DWORD *effect) {
  (void)self; (void)keys; (void)pt;
  if (effect) *effect = DROPEFFECT_COPY;
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE dt_DragLeave(IDropTarget *self) {
  (void)self;
  return S_OK;
}
static HRESULT STDMETHODCALLTYPE dt_Drop(IDropTarget *self, IDataObject *obj, DWORD keys, POINTL pt, DWORD *effect) {
  (void)self; (void)keys; (void)pt;
  open_selection(obj);
  if (effect) *effect = DROPEFFECT_COPY;
  return S_OK;
}

static IDropTargetVtbl g_dt_vtbl = {
  dt_QueryInterface, dt_AddRef, dt_Release, dt_DragEnter, dt_DragOver, dt_DragLeave, dt_Drop
};

/* ---------- the class factory ---------- */

typedef struct MakanFactory {
  IClassFactory iface;
} MakanFactory;

static HRESULT STDMETHODCALLTYPE cf_QueryInterface(IClassFactory *self, REFIID riid, void **ppv) {
  if (!ppv) return E_POINTER;
  if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_IClassFactory)) {
    *ppv = self;
    return S_OK;
  }
  *ppv = NULL;
  return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE cf_AddRef(IClassFactory *self) { (void)self; return 2; }
static ULONG STDMETHODCALLTYPE cf_Release(IClassFactory *self) { (void)self; return 1; }
static HRESULT STDMETHODCALLTYPE cf_CreateInstance(IClassFactory *self, IUnknown *outer, REFIID riid, void **ppv) {
  MakanDrop *d;
  HRESULT hr;
  (void)self;
  if (!ppv) return E_POINTER;
  *ppv = NULL;
  if (outer) return CLASS_E_NOAGGREGATION;
  d = (MakanDrop *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(MakanDrop));
  if (!d) return E_OUTOFMEMORY;
  d->iface.lpVtbl = &g_dt_vtbl;
  d->ref = 1;
  InterlockedIncrement(&g_objects);
  hr = dt_QueryInterface(&d->iface, riid, ppv);
  dt_Release(&d->iface);
  return hr;
}
static HRESULT STDMETHODCALLTYPE cf_LockServer(IClassFactory *self, BOOL lock) {
  (void)self;
  if (lock) InterlockedIncrement(&g_locks); else InterlockedDecrement(&g_locks);
  return S_OK;
}

static IClassFactoryVtbl g_cf_vtbl = { cf_QueryInterface, cf_AddRef, cf_Release, cf_CreateInstance, cf_LockServer };
static MakanFactory g_factory = { { &g_cf_vtbl } };

__declspec(dllexport) HRESULT STDAPICALLTYPE DllGetClassObject(REFCLSID rclsid, REFIID riid, void **ppv) {
  if (!ppv) return E_POINTER;
  *ppv = NULL;
  if (!IsEqualCLSID(rclsid, &CLSID_MakanOpen)) return CLASS_E_CLASSNOTAVAILABLE;
  return cf_QueryInterface(&g_factory.iface, riid, ppv);
}

__declspec(dllexport) HRESULT STDAPICALLTYPE DllCanUnloadNow(void) {
  return (g_objects == 0 && g_locks == 0) ? S_OK : S_FALSE;
}

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(inst);
  return TRUE;
}
