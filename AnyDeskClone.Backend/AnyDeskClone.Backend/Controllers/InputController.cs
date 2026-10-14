using Microsoft.AspNetCore.Mvc;
using AnyDeskClone.Backend.Models;
using AnyDeskClone.Backend.Services;

namespace AnyDeskClone.Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class InputController : ControllerBase
{
    private readonly ISessionService _sessionService;
    private readonly IInputSimulatorService _inputSimulator;

    public InputController(ISessionService sessionService, IInputSimulatorService inputSimulator)
    {
        _sessionService = sessionService;
        _inputSimulator = inputSimulator;
    }

    [HttpPost]
    public IActionResult PostInput([FromBody] RemoteInputEvent inputEvent)
    {
        if (string.IsNullOrEmpty(inputEvent.SessionId))
        {
            return BadRequest(new { message = "SessionId is required." });
        }

        var session = _sessionService.GetSession(inputEvent.SessionId);
        if (session == null || (session.State != SessionState.Approved && session.State != SessionState.Active))
        {
            return StatusCode(403, new { message = "Session is not active or approved." });
        }

        bool simulated = _inputSimulator.SimulateInput(inputEvent, session.Permissions);
        return Ok(new { success = simulated });
    }
}
