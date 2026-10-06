// Mesh2STEP Desktop — Program.cs
// Versione: 1.4.1 — 2026-10-07 00:40 (Europe/Rome)
// Finestra WinForms con WebView2. Tutti i file web sono risorse incorporate servite su
// https://app.mesh2step/ tramite WebResourceRequested (nessun file estratto su disco).
// Argomento da riga di comando (o "Apri con…" / trascinamento sull'exe): il file viene servito su
// https://app.mesh2step/open/<nome> e aperto con il parametro ?url= dell'app.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Mesh2Step.Desktop
{
    internal static class Program
    {
        const string Host = "https://app.mesh2step/";

        // tipi MIME per le risorse servite
        static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
        {
            [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css",
            [".png"] = "image/png", [".json"] = "application/json", [".webmanifest"] = "application/manifest+json",
            [".stl"] = "application/octet-stream", [".obj"] = "text/plain", [".3mf"] = "application/octet-stream",
        };

        // nome normalizzato ('/') -> nome reale della risorsa incorporata
        static readonly Dictionary<string, string> Resources = new(StringComparer.Ordinal);
        static Program()
        {
            foreach (var n in Assembly.GetExecutingAssembly().GetManifestResourceNames()) Resources[n.Replace('\\', '/')] = n;
        }

        [STAThread]
        static void Main(string[] args)
        {
            ApplicationConfiguration.Initialize();
            string fileArg = args.Length > 0 && File.Exists(args[0]) ? Path.GetFullPath(args[0]) : null;

            var form = new Form { Text = "Mesh2STEP", Width = 1400, Height = 900, StartPosition = FormStartPosition.CenterScreen };
            try { form.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch { /* icona di default */ }
            var web = new WebView2 { Dock = DockStyle.Fill };
            form.Controls.Add(web);

            form.Load += async (_, _) =>
            {
                // profilo WebView2 nella cartella dati utente (l'exe resta portabile e non scrive accanto a sé)
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mesh2STEP", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, data);
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.AddWebResourceRequestedFilter(Host + "*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += (s, e) =>
                {
                    var uri = new Uri(e.Request.Uri);
                    string path = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
                    if (path == "") path = "index.html";
                    Stream body = null;
                    if (path.StartsWith("open/") && fileArg != null) body = File.OpenRead(fileArg);
                    // [2026-10-07 v1.4.1] prima: else body = Assembly.GetExecutingAssembly().GetManifestResourceStream("www/" + path);
                    // sui build Windows %(RecursiveDir) usa '\' (www/src\app.js): i nomi si confrontano con '\' -> '/'
                    else body = Resources.TryGetValue("www/" + path, out var resName) ? Assembly.GetExecutingAssembly().GetManifestResourceStream(resName) : null;
                    if (body == null) { e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
                    Mime.TryGetValue(Path.GetExtension(path), out var type);
                    e.Response = core.Environment.CreateWebResourceResponse(body, 200, "OK", "Content-Type: " + (type ?? "application/octet-stream"));
                };
                string start = Host + "index.html";
                if (fileArg != null) start += "?url=" + Uri.EscapeDataString(Host + "open/" + Path.GetFileName(fileArg));
                core.Navigate(start);
            };
            Application.Run(form);
        }
    }
}
