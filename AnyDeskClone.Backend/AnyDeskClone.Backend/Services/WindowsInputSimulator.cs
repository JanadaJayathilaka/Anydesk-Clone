using System.Runtime.InteropServices;
using AnyDeskClone.Backend.Models;

namespace AnyDeskClone.Backend.Services;

public class WindowsInputSimulator : IInputSimulatorService
{
    private readonly ILogger<WindowsInputSimulator> _logger;

    public WindowsInputSimulator(ILogger<WindowsInputSimulator> logger)
    {
        _logger = logger;
    }

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    private const uint KEYEVENTF_KEYUP = 0x0002;

    public bool SimulateInput(RemoteInputEvent inputEvent, SessionPermissions permissions)
    {
        if (!permissions.AllowControl)
        {
            _logger.LogWarning("Input ignored: Remote control permission is disabled");
            return false;
        }

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            _logger.LogInformation("Simulation on non-windows platform: {Type}", inputEvent.Type);
            return true;
        }

        try
        {
            switch (inputEvent.Type.ToLowerInvariant())
            {
                case "mousemove":
                    if (!permissions.AllowMouse) return false;
                    MoveMouse(inputEvent.NormalizedX, inputEvent.NormalizedY);
                    return true;

                case "mousedown":
                    if (!permissions.AllowMouse) return false;
                    MoveMouse(inputEvent.NormalizedX, inputEvent.NormalizedY);
                    MouseDown(inputEvent.Button);
                    return true;

                case "mouseup":
                    if (!permissions.AllowMouse) return false;
                    MoveMouse(inputEvent.NormalizedX, inputEvent.NormalizedY);
                    MouseUp(inputEvent.Button);
                    return true;

                case "click":
                    if (!permissions.AllowMouse) return false;
                    MoveMouse(inputEvent.NormalizedX, inputEvent.NormalizedY);
                    MouseDown(inputEvent.Button);
                    MouseUp(inputEvent.Button);
                    return true;

                case "wheel":
                    if (!permissions.AllowMouse) return false;
                    MouseWheel((int)inputEvent.DeltaY);
                    return true;

                case "keydown":
                    if (!permissions.AllowKeyboard) return false;
                    HandleKey(inputEvent, isKeyUp: false);
                    return true;

                case "keyup":
                    if (!permissions.AllowKeyboard) return false;
                    HandleKey(inputEvent, isKeyUp: true);
                    return true;

                case "specialkey":
                    if (!permissions.AllowKeyboard) return false;
                    HandleSpecialKey(inputEvent.SpecialKey);
                    return true;

                default:
                    _logger.LogWarning("Unknown input type: {Type}", inputEvent.Type);
                    return false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to simulate input {Type}", inputEvent.Type);
            return false;
        }
    }

    private void MoveMouse(double normalizedX, double normalizedY)
    {
        int screenWidth = GetSystemMetrics(SM_CXSCREEN);
        int screenHeight = GetSystemMetrics(SM_CYSCREEN);

        int targetX = Math.Clamp((int)(normalizedX * screenWidth), 0, screenWidth - 1);
        int targetY = Math.Clamp((int)(normalizedY * screenHeight), 0, screenHeight - 1);

        SetCursorPos(targetX, targetY);
    }

    private void MouseDown(int button)
    {
        uint flag = button switch
        {
            0 => MOUSEEVENTF_LEFTDOWN,
            1 => MOUSEEVENTF_MIDDLEDOWN,
            2 => MOUSEEVENTF_RIGHTDOWN,
            _ => MOUSEEVENTF_LEFTDOWN
        };
        mouse_event(flag, 0, 0, 0, 0);
    }

    private void MouseUp(int button)
    {
        uint flag = button switch
        {
            0 => MOUSEEVENTF_LEFTUP,
            1 => MOUSEEVENTF_MIDDLEUP,
            2 => MOUSEEVENTF_RIGHTUP,
            _ => MOUSEEVENTF_LEFTUP
        };
        mouse_event(flag, 0, 0, 0, 0);
    }

    private void MouseWheel(int deltaY)
    {
        // Windows wheel delta is in multiples of WHEEL_DELTA (120)
        uint data = (uint)(-deltaY * 3);
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, data, 0);
    }

    private void HandleKey(RemoteInputEvent evt, bool isKeyUp)
    {
        byte vk = GetVirtualKeyCode(evt.Code, evt.KeyCode);
        if (vk == 0) return;

        uint flags = isKeyUp ? KEYEVENTF_KEYUP : 0;
        keybd_event(vk, 0, flags, 0);
    }

    private void HandleSpecialKey(string? specialKey)
    {
        if (string.IsNullOrWhiteSpace(specialKey)) return;

        switch (specialKey.ToLowerInvariant())
        {
            case "win":
            case "lwin":
                // Tap Windows key (VK_LWIN = 0x5B)
                keybd_event(0x5B, 0, 0, 0);
                keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0);
                break;

            case "escape":
                keybd_event(0x1B, 0, 0, 0);
                keybd_event(0x1B, 0, KEYEVENTF_KEYUP, 0);
                break;

            case "alttab":
                // Alt + Tab
                keybd_event(0x12, 0, 0, 0); // VK_MENU (Alt)
                keybd_event(0x09, 0, 0, 0); // VK_TAB
                keybd_event(0x09, 0, KEYEVENTF_KEYUP, 0);
                keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0);
                break;

            case "ctrlaltdel":
                _logger.LogInformation("Ctrl+Alt+Del requested. (Windows Secure Desktop intercepts this for security)");
                break;
        }
    }

    private static byte GetVirtualKeyCode(string? code, int fallbackKeyCode)
    {
        if (string.IsNullOrEmpty(code))
        {
            return (byte)fallbackKeyCode;
        }

        return code switch
        {
            "Enter" => 0x0D,
            "Backspace" => 0x08,
            "Tab" => 0x09,
            "Escape" => 0x1B,
            "Space" => 0x20,
            "ArrowLeft" => 0x25,
            "ArrowUp" => 0x26,
            "ArrowRight" => 0x27,
            "ArrowDown" => 0x28,
            "Delete" => 0x2E,
            "ControlLeft" or "ControlRight" => 0x11,
            "ShiftLeft" or "ShiftRight" => 0x10,
            "AltLeft" or "AltRight" => 0x12,
            "MetaLeft" or "MetaRight" => 0x5B,
            _ => (fallbackKeyCode > 0 && fallbackKeyCode <= 255) ? (byte)fallbackKeyCode : (byte)0
        };
    }
}
