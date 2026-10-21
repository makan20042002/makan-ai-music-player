#include <windows.h>
#include <stdio.h>
int main(void){ FILE*f=fopen("fake-out.txt","wb"); fputws(GetCommandLineW(), f ? f : stdout); if(f) fclose(f); return 0; }
