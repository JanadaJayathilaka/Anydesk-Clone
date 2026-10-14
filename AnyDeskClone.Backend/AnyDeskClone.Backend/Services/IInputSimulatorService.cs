using AnyDeskClone.Backend.Models;

namespace AnyDeskClone.Backend.Services;

public interface IInputSimulatorService
{
    bool SimulateInput(RemoteInputEvent inputEvent, SessionPermissions permissions);
}
