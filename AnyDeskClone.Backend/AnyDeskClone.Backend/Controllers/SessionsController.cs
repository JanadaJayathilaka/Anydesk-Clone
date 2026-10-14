using Microsoft.AspNetCore.Mvc;
using AnyDeskClone.Backend.Models;
using AnyDeskClone.Backend.Services;

namespace AnyDeskClone.Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SessionsController : ControllerBase
{
    private readonly ISessionService _sessionService;

    public SessionsController(ISessionService sessionService)
    {
        _sessionService = sessionService;
    }

    [HttpGet("{id}")]
    public IActionResult GetSession(string id)
    {
        var session = _sessionService.GetSession(id);
        if (session == null)
        {
            return NotFound(new { message = $"Session {id} not found." });
        }
        return Ok(session);
    }

    [HttpPost("request")]
    public IActionResult RequestSession([FromBody] SessionRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.HostDeviceId))
        {
            return BadRequest(new { message = "HostDeviceId is required." });
        }

        var host = _sessionService.GetDevice(request.HostDeviceId);
        if (host == null || !host.IsOnline)
        {
            return NotFound(new { message = "Host device is offline or not found." });
        }

        var session = _sessionService.CreateSession(request.ControllerDeviceId, request.HostDeviceId, request.ControllerName);
        return Ok(session);
    }

    [HttpPost("{id}/approve")]
    public IActionResult ApproveSession(string id, [FromBody] SessionApprovalDto dto)
    {
        var session = _sessionService.ApproveSession(id, dto.Permissions);
        if (session == null)
        {
            return NotFound(new { message = $"Session {id} not found." });
        }
        return Ok(session);
    }

    [HttpPost("{id}/reject")]
    public IActionResult RejectSession(string id)
    {
        var session = _sessionService.RejectSession(id);
        if (session == null)
        {
            return NotFound(new { message = $"Session {id} not found." });
        }
        return Ok(session);
    }

    [HttpPost("{id}/end")]
    public IActionResult EndSession(string id)
    {
        var session = _sessionService.EndSession(id);
        if (session == null)
        {
            return NotFound(new { message = $"Session {id} not found." });
        }
        return Ok(session);
    }
}
