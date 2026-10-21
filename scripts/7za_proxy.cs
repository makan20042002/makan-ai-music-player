using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

class Program {
    static int Main(string[] args) {
        var dir = AppDomain.CurrentDomain.BaseDirectory;
        var real7za = Path.Combine(dir, "7za_real.exe");
        var list = args.ToList();
        if (list.Contains("x") && !list.Any(a => a.Contains("darwin"))) {
            list.Add("-xr!darwin");
        }
        var psi = new ProcessStartInfo {
            FileName = real7za,
            Arguments = string.Join(" ", list.Select(a => a.Contains(" ") ? "\"" + a + "\"" : a)),
            UseShellExecute = false
        };
        try {
            var p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }
}
