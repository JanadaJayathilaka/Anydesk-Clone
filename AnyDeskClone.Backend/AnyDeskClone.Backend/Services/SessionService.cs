using System.Collections.Concurrent;
using AnyDeskClone.Backend.Models;

namespace AnyDeskClone.Backend.Services;

public class SessionService : ISessionService
{
    private readonly ConcurrentDictionary<string, DeviceRegistration> _devices = new();
    private readonly ConcurrentDictionary<string, RemoteSession> _sessions = new();
    private readonly ILogger<SessionService> _logger;

    public SessionService(ILogger<SessionService> logger)
    {
        _logger = logger;
    }

    public DeviceRegistration RegisterDevice(string deviceId, string deviceName, string connectionId)
    {
        var device = new DeviceRegistration
        {
            DeviceId = deviceId,
            DeviceName = string.IsNullOrWhiteSpace(deviceName) ? "Windows PC" : deviceName,
            ConnectionId = connectionId,
            ConnectedAt = DateTime.UtcNow,
            LastHeartbeat = DateTime.UtcNow
        };

        _devices[deviceId] = device;
        _logger.LogInformation("Device registered: {DeviceId} ({DeviceName}) with connection {ConnectionId}", 
            deviceId, deviceName, connectionId);

        return device;
    }

    public bool UpdateHeartbeat(string deviceId)
    {
        if (_devices.TryGetValue(deviceId, out var device))
        {
            device.LastHeartbeat = DateTime.UtcNow;
            return true;
        }
        return false;
    }

    public DeviceRegistration? UnregisterByConnectionId(string connectionId)
    {
        var match = _devices.FirstOrDefault(d => d.Value.ConnectionId == connectionId);
        if (!string.IsNullOrEmpty(match.Key))
        {
            _devices.TryRemove(match.Key, out var removed);
            _logger.LogInformation("Device unregistered: {DeviceId}", match.Key);

            // Clean up any pending or active sessions involving this device
            foreach (var kvp in _sessions)
            {
                var s = kvp.Value;
                if ((s.HostDeviceId == match.Key || s.ControllerDeviceId == match.Key) &&
                    (s.State == SessionState.Active || s.State == SessionState.WaitingApproval || s.State == SessionState.Pending))
                {
                    s.State = SessionState.Ended;
                    s.EndedAt = DateTime.UtcNow;
                }
            }

            return removed;
        }
        return null;
    }

    public DeviceRegistration? GetDevice(string deviceId)
    {
        _devices.TryGetValue(deviceId, out var device);
        return device;
    }

    public IEnumerable<DeviceRegistration> GetAllDevices()
    {
        return _devices.Values;
    }

    public RemoteSession CreateSession(string controllerDeviceId, string hostDeviceId, string controllerName)
    {
        var session = new RemoteSession
        {
            ControllerDeviceId = controllerDeviceId,
            HostDeviceId = hostDeviceId,
            ControllerName = string.IsNullOrWhiteSpace(controllerName) ? "Remote Controller" : controllerName,
            State = SessionState.WaitingApproval,
            CreatedAt = DateTime.UtcNow
        };

        _sessions[session.SessionId] = session;
        _logger.LogInformation("Session created: {SessionId} from Controller {ControllerId} to Host {HostId}",
            session.SessionId, controllerDeviceId, hostDeviceId);

        return session;
    }

    public RemoteSession? ApproveSession(string sessionId, SessionPermissions permissions)
    {
        if (_sessions.TryGetValue(sessionId, out var session))
        {
            session.State = SessionState.Approved;
            session.StartedAt = DateTime.UtcNow;
            session.Permissions = permissions;
            _logger.LogInformation("Session approved: {SessionId}", sessionId);
            return session;
        }
        return null;
    }

    public RemoteSession? RejectSession(string sessionId)
    {
        if (_sessions.TryGetValue(sessionId, out var session))
        {
            session.State = SessionState.Rejected;
            session.EndedAt = DateTime.UtcNow;
            _logger.LogInformation("Session rejected: {SessionId}", sessionId);
            return session;
        }
        return null;
    }

    public RemoteSession? EndSession(string sessionId)
    {
        if (_sessions.TryGetValue(sessionId, out var session))
        {
            session.State = SessionState.Ended;
            session.EndedAt = DateTime.UtcNow;
            _logger.LogInformation("Session ended: {SessionId}", sessionId);
            return session;
        }
        return null;
    }

    public RemoteSession? GetSession(string sessionId)
    {
        _sessions.TryGetValue(sessionId, out var session);
        return session;
    }

    public RemoteSession? GetActiveSessionForDevice(string deviceId)
    {
        return _sessions.Values
            .FirstOrDefault(s => (s.HostDeviceId == deviceId || s.ControllerDeviceId == deviceId) &&
                                 (s.State == SessionState.Active || s.State == SessionState.Approved || s.State == SessionState.WaitingApproval));
    }

    public int ActiveSessionCount => _sessions.Values.Count(s => s.State == SessionState.Active || s.State == SessionState.Approved);
    public int ActiveDeviceCount => _devices.Values.Count(d => d.IsOnline);
}
