using Microsoft.AspNetCore.SignalR;
using AnyDeskClone.Backend.Models;
using AnyDeskClone.Backend.Services;

namespace AnyDeskClone.Backend.Hubs;

public class SessionHub : Hub
{
    private readonly ISessionService _sessionService;
    private readonly IInputSimulatorService _inputSimulator;
    private readonly ILogger<SessionHub> _logger;

    public SessionHub(
        ISessionService sessionService,
        IInputSimulatorService inputSimulator,
        ILogger<SessionHub> logger)
    {
        _sessionService = sessionService;
        _inputSimulator = inputSimulator;
        _logger = logger;
    }

    public async Task<DeviceRegistration> RegisterDevice(string deviceId, string deviceName)
    {
        var device = _sessionService.RegisterDevice(deviceId, deviceName, Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"device_{deviceId}");
        _logger.LogInformation("Client {ConnectionId} registered as device {DeviceId}", Context.ConnectionId, deviceId);
        return device;
    }

    public Task Heartbeat(string deviceId)
    {
        _sessionService.UpdateHeartbeat(deviceId);
        return Task.CompletedTask;
    }

    public async Task<SessionResponseDto> RequestSession(string hostDeviceId, string controllerDeviceId, string controllerName)
    {
        var host = _sessionService.GetDevice(hostDeviceId);
        if (host == null || !host.IsOnline)
        {
            throw new HubException("Host device is offline or not found.");
        }

        var session = _sessionService.CreateSession(controllerDeviceId, hostDeviceId, controllerName);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"session_{session.SessionId}");

        // Notify the host device about the incoming connection request
        await Clients.Group($"device_{hostDeviceId}").SendAsync("SessionIncoming", new
        {
            sessionId = session.SessionId,
            controllerDeviceId = session.ControllerDeviceId,
            controllerName = session.ControllerName,
            createdAt = session.CreatedAt
        });

        return new SessionResponseDto
        {
            SessionId = session.SessionId,
            HostDeviceId = session.HostDeviceId,
            ControllerDeviceId = session.ControllerDeviceId,
            ControllerName = session.ControllerName,
            State = session.State.ToString(),
            CreatedAt = session.CreatedAt,
            Permissions = session.Permissions
        };
    }

    public async Task RespondSession(string sessionId, bool approved, SessionPermissions permissions)
    {
        var session = approved 
            ? _sessionService.ApproveSession(sessionId, permissions)
            : _sessionService.RejectSession(sessionId);

        if (session == null)
        {
            throw new HubException("Session not found.");
        }

        if (approved)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"session_{sessionId}");
            
            var approvedPayload = new
            {
                sessionId = session.SessionId,
                hostDeviceId = session.HostDeviceId,
                permissions = session.Permissions,
                startedAt = session.StartedAt
            };

            // Notify controller
            var controllerDevice = _sessionService.GetDevice(session.ControllerDeviceId);
            if (controllerDevice != null && !string.IsNullOrEmpty(controllerDevice.ConnectionId))
            {
                await Clients.Client(controllerDevice.ConnectionId).SendAsync("SessionApproved", approvedPayload);
            }
            else
            {
                await Clients.Group($"device_{session.ControllerDeviceId}").SendAsync("SessionApproved", approvedPayload);
            }

            // Notify host
            await Clients.Caller.SendAsync("SessionStarted", new
            {
                sessionId = session.SessionId,
                controllerDeviceId = session.ControllerDeviceId,
                permissions = session.Permissions
            });
        }
        else
        {
            var rejectPayload = new
            {
                sessionId = session.SessionId,
                reason = "Host rejected the connection request."
            };
            var controllerDevice = _sessionService.GetDevice(session.ControllerDeviceId);
            if (controllerDevice != null && !string.IsNullOrEmpty(controllerDevice.ConnectionId))
            {
                await Clients.Client(controllerDevice.ConnectionId).SendAsync("SessionRejected", rejectPayload);
            }
            else
            {
                await Clients.Group($"device_{session.ControllerDeviceId}").SendAsync("SessionRejected", rejectPayload);
            }
        }
    }

    public async Task SendSignal(SignalMessage message)
    {
        // If TargetDeviceId is not explicitly specified, resolve it from the active session
        if (string.IsNullOrEmpty(message.TargetDeviceId) && !string.IsNullOrEmpty(message.SessionId))
        {
            var session = _sessionService.GetSession(message.SessionId);
            if (session != null)
            {
                message.TargetDeviceId = session.HostDeviceId == message.SenderDeviceId
                    ? session.ControllerDeviceId
                    : session.HostDeviceId;
            }
        }

        if (string.IsNullOrEmpty(message.TargetDeviceId))
        {
            _logger.LogWarning("SendSignal: TargetDeviceId could not be resolved for type {Type}", message.Type);
            return;
        }

        var payload = new
        {
            sessionId = message.SessionId,
            senderDeviceId = message.SenderDeviceId,
            targetDeviceId = message.TargetDeviceId,
            type = message.Type,
            payload = message.Payload
        };

            // Forward signaling payload directly to the target device (or its device group if connection ID is transitioning)
            var targetDevice = _sessionService.GetDevice(message.TargetDeviceId);
            if (targetDevice != null && !string.IsNullOrEmpty(targetDevice.ConnectionId))
            {
                await Clients.Client(targetDevice.ConnectionId).SendAsync("ReceiveSignal", payload);
            }
            else
            {
                await Clients.Group($"device_{message.TargetDeviceId}").SendAsync("ReceiveSignal", payload);
            }
        }

    public async Task SendInput(RemoteInputEvent inputEvent)
    {
        var session = _sessionService.GetSession(inputEvent.SessionId);
        if (session == null || session.State != SessionState.Approved && session.State != SessionState.Active)
        {
            return;
        }

        // 1. Simulate on local Windows host if this host is local
        _inputSimulator.SimulateInput(inputEvent, session.Permissions);

        // 2. Also forward to the host connection in case host is a remote desktop agent
        await Clients.Group($"device_{session.HostDeviceId}").SendAsync("ReceiveInput", inputEvent);
    }

    public async Task EndSession(string sessionId)
    {
        var session = _sessionService.EndSession(sessionId);
        if (session != null)
        {
            await Clients.Group($"session_{sessionId}").SendAsync("SessionEnded", new
            {
                sessionId = session.SessionId,
                endedAt = session.EndedAt
            });
            await Clients.Group($"device_{session.HostDeviceId}").SendAsync("SessionEnded", new { sessionId });
            await Clients.Group($"device_{session.ControllerDeviceId}").SendAsync("SessionEnded", new { sessionId });
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var device = _sessionService.UnregisterByConnectionId(Context.ConnectionId);
        if (device != null)
        {
            _logger.LogInformation("Device disconnected: {DeviceId}", device.DeviceId);
        }
        await base.OnDisconnectedAsync(exception);
    }
}
