// Windows x64 helper. Canon's EDSDK DLLs are installed separately under Canon's SDK licence.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class CanonWorker {
    const string DLL = "EDSDK.dll";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static IntPtr camera;
    static bool connected;
    static string model = "", folder;
    static DateTime releaseAt = DateTime.MaxValue;
    static readonly ObjectHandler objectHandler = OnObject;
    static readonly StateHandler stateHandler = OnState;
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ObjectHandler(uint kind, IntPtr item, IntPtr context);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint StateHandler(uint kind, uint data, IntPtr context);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] struct DeviceInfo {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string port;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string description;
        public uint subtype, reserved;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] struct ItemInfo {
        public ulong size; public int isFolder; public uint group, option;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string name;
        public uint format, date;
    }
    [StructLayout(LayoutKind.Sequential)] struct Capacity { public int clusters, sectorSize, reset; }
    [DllImport(DLL)] static extern uint EdsInitializeSDK();
    [DllImport(DLL)] static extern uint EdsTerminateSDK();
    [DllImport(DLL)] static extern uint EdsGetCameraList(out IntPtr list);
    [DllImport(DLL)] static extern uint EdsGetChildCount(IntPtr list, out int count);
    [DllImport(DLL)] static extern uint EdsGetChildAtIndex(IntPtr list, int index, out IntPtr child);
    [DllImport(DLL)] static extern uint EdsGetDeviceInfo(IntPtr cam, out DeviceInfo info);
    [DllImport(DLL)] static extern uint EdsOpenSession(IntPtr cam);
    [DllImport(DLL)] static extern uint EdsCloseSession(IntPtr cam);
    [DllImport(DLL)] static extern uint EdsRelease(IntPtr obj);
    [DllImport(DLL)] static extern uint EdsSetObjectEventHandler(IntPtr cam, uint kind, ObjectHandler handler, IntPtr ctx);
    [DllImport(DLL)] static extern uint EdsSetCameraStateEventHandler(IntPtr cam, uint kind, StateHandler handler, IntPtr ctx);
    [DllImport(DLL)] static extern uint EdsSetPropertyData(IntPtr cam, uint property, int parameter, int size, ref uint value);
    [DllImport(DLL)] static extern uint EdsSetCapacity(IntPtr cam, Capacity capacity);
    [DllImport(DLL)] static extern uint EdsSendCommand(IntPtr cam, uint command, int parameter);
    [DllImport(DLL)] static extern uint EdsGetEvent();
    [DllImport(DLL)] static extern uint EdsGetDirectoryItemInfo(IntPtr item, out ItemInfo info);
    [DllImport(DLL, CharSet = CharSet.Ansi)] static extern uint EdsCreateFileStream(string path, uint disposition, uint access, out IntPtr stream);
    [DllImport(DLL)] static extern uint EdsDownload(IntPtr item, ulong size, IntPtr stream);
    [DllImport(DLL)] static extern uint EdsDownloadComplete(IntPtr item);
    [DllImport(DLL)] static extern uint EdsDownloadCancel(IntPtr item);

    static void Check(uint code) {
        if (code != 0) throw new InvalidOperationException("Canon EDSDK 0x" + code.ToString("X8") + ". Kiem tra cap USB, firmware R50 >= 1.3.0; thoat EOS Utility va EOS Webcam Utility.");
    }
    static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    static object Status() { return new { connected = connected, model = model, folder = folder }; }
    static void Close() {
        if (camera != IntPtr.Zero) {
            if (connected) { EdsSendCommand(camera, 4, 0); EdsCloseSession(camera); }
            EdsRelease(camera); camera = IntPtr.Zero;
        }
        connected = false; model = "";
    }
    static void Connect() {
        if (connected) { DeviceInfo current; if (EdsGetDeviceInfo(camera, out current) == 0) return; }
        Close();
        IntPtr list; Check(EdsGetCameraList(out list));
        try {
            int count; Check(EdsGetChildCount(list, out count));
            for (int i = 0; i < count; i++) {
                IntPtr candidate; Check(EdsGetChildAtIndex(list, i, out candidate));
                DeviceInfo info;
                uint code = EdsGetDeviceInfo(candidate, out info);
                if (code == 0 && String.Equals(info.description, "Canon EOS R50", StringComparison.OrdinalIgnoreCase)) {
                    camera = candidate; model = info.description; break;
                }
                EdsRelease(candidate);
            }
            if (camera == IntPtr.Zero) throw new InvalidOperationException("Khong thay Canon EOS R50. Bat may, cam USB du lieu va chon Photo Import/Remote Control.");
            Check(EdsOpenSession(camera)); connected = true;
            Check(EdsSetObjectEventHandler(camera, 0x200, objectHandler, IntPtr.Zero));
            Check(EdsSetCameraStateEventHandler(camera, 0x300, stateHandler, IntPtr.Zero));
            uint saveToHost = 2;
            Check(EdsSetPropertyData(camera, 0x0B, 0, 4, ref saveToHost));
            Check(EdsSetCapacity(camera, new Capacity { clusters = 0x7FFFFFFF, sectorSize = 4096, reset = 1 }));
        } catch { Close(); throw; }
        finally { EdsRelease(list); }
    }
    static uint OnState(uint kind, uint data, IntPtr context) {
        if (kind == 0x301) connected = false;
        if (kind == 0x303 && connected) EdsSendCommand(camera, 1, 0);
        return 0;
    }
    static uint OnObject(uint kind, IntPtr item, IntPtr context) {
        if (item == IntPtr.Zero) return 0;
        try {
            if (kind != 0x208) return 0; // DirItemRequestTransfer
            ItemInfo info; Check(EdsGetDirectoryItemInfo(item, out info));
            string ext = Path.GetExtension(info.name).ToLowerInvariant();
            if (ext != ".jpg" && ext != ".jpeg") {
                EdsDownloadCancel(item);
                Emit(new { type = "warning", error = "May anh khong gui JPEG. Chon JPEG Large/Fine hoac RAW+JPEG." });
                return 0;
            }
            string name = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + "-" + Guid.NewGuid().ToString("N").Substring(0,8) + ".jpg";
            string output = Path.Combine(folder, name), temporary = output + ".part";
            IntPtr stream = IntPtr.Zero;
            try {
                Check(EdsCreateFileStream(temporary, 1, 2, out stream)); // CreateAlways, ReadWrite
                Check(EdsDownload(item, info.size, stream));
                Check(EdsDownloadComplete(item));
            } catch { EdsDownloadCancel(item); throw; }
            finally { if (stream != IntPtr.Zero) EdsRelease(stream); }
            File.Move(temporary, output); // Only complete JPEGs become visible to the kiosk's watcher.
            Emit(new { type = "photo", name = name, size = info.size });
        } catch (Exception error) { Emit(new { type = "warning", error = error.Message }); }
        finally { EdsRelease(item); }
        return 0;
    }
    static object Execute(Dictionary<string, object> command) {
        string action = Convert.ToString(command["action"]);
        if (action == "status") return Status();
        if (action == "connect") { Connect(); return Status(); }
        if (action == "release") {
            if (connected) Check(EdsSendCommand(camera, 4, 0));
            releaseAt = DateTime.MaxValue; return Status();
        }
        if (!connected) throw new InvalidOperationException("Canon R50 chua ket noi USB.");
        long expires = Convert.ToInt64(command["expiresAt"]);
        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > expires) throw new InvalidOperationException("Lenh chup da het han; khong chup muon.");
        if (action == "focus") {
            Check(EdsSendCommand(camera, 4, 1));
            releaseAt = DateTime.UtcNow.AddSeconds(4);
        } else if (action == "shoot") {
            // One exposure. Never retry this command after a lost response.
            try { Check(EdsSendCommand(camera, 4, 3)); }
            finally { EdsSendCommand(camera, 4, 0); releaseAt = DateTime.MaxValue; }
        } else throw new InvalidOperationException("Unknown camera action.");
        return Status();
    }
    [STAThread] public static int Main(string[] args) {
        bool initialized = false;
        try {
            folder = Path.GetFullPath(args[0]); Directory.CreateDirectory(folder);
            Check(EdsInitializeSDK()); initialized = true;
            // Console.In can implement ReadLineAsync synchronously on .NET Framework.
            // Keep stdin reads off the STA thread so SDK events and photo transfers keep pumping.
            Task<string> input = Task.Run(() => Console.ReadLine());
            while (true) {
                Application.DoEvents(); Check(EdsGetEvent());
                if (connected && DateTime.UtcNow >= releaseAt) { EdsSendCommand(camera, 4, 0); releaseAt = DateTime.MaxValue; }
                if (input.IsCompleted) {
                    string line = input.Result; if (line == null) break;
                    string id = "";
                    try {
                        var command = Json.Deserialize<Dictionary<string, object>>(line);
                        id = Convert.ToString(command["id"]);
                        Emit(new { id = id, ok = true, value = Execute(command) });
                    } catch (Exception error) { Emit(new { id = id, ok = false, error = error.Message }); }
                    input = Task.Run(() => Console.ReadLine());
                }
                Thread.Sleep(10);
            }
            return 0;
        } catch (Exception error) {
            Emit(new { type = "fatal", error = error.Message }); return 1;
        } finally { if (initialized) { Close(); EdsTerminateSDK(); } }
    }
}
