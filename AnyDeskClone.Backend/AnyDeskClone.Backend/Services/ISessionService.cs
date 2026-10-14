using AnyDeskClone.Backend.Models;

namespace AnyDeskClone.Backend.Services;

public interface ISessionService
{
    DeviceRegistration RegisterDevice(string deviceId, string deviceName, string connectionId);
    bool UpdateHeartbeat(string deviceId);
    DeviceRegistration? UnregisterByConnectionId(string connectionId);
    DeviceRegistration? GetDevice(string deviceId);
    IEnumerable<DeviceRegistration> GetAllDevices();
    
    RemoteSession CreateSession(string controllerDeviceId, string hostDeviceId, string controllerName);
    RemoteSession? ApproveSession(string sessionId, SessionPermissions permissions);
    RemoteSession? RejectSession(string sessionId);
    RemoteSession? EndSession(string sessionId);
    RemoteSession? GetSession(string sessionId);
    RemoteSession? GetActiveSessionForDevice(string deviceId);
    
    int ActiveSessionCount { get; }
    int ActiveDeviceCount { get; }
}
