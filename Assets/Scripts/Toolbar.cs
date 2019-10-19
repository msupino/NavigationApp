using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using TMPro;
public class ActionEvent : UnityEvent<ToolType>
{
}

public class InfoEvent : UnityEvent<string>
{
}

public enum ToolType
{
    None,
    Draw,
    Erase,
    Reverse,
    NewScene,
    SaveScene,
    LoadScene,
    Settings,
    Print
}



public enum ButtonType
{
    Tool,
    Action
}

public class Toolbar : MonoBehaviour
{
    public ToolType currentTool;
    // public GameObject stopBanner;
    public List<GameObject> buttons = new List<GameObject>();
    public UnityEvent eventDrawing = new UnityEvent();
    public UnityEvent eventStopDrawing = new UnityEvent();
    public UnityEvent eventErase = new UnityEvent();
    public UnityEvent eventStopErase = new UnityEvent();
    public ActionEvent eventActionTriggered = new ActionEvent();
    public GameObject infoPanel;
    public TextMeshProUGUI infoLabel; 

    private string currentToolDescription = null;

    public Toolbar()
    {

    }

    private void Start()
    {
        // stopBanner.SetActive(false);
        displayInfo(null);
    }

    public void displayInfo(string text)
    {
        if (text != null) 
        {
            infoLabel.text = text;
        }
        else
        {
            if (currentTool != ToolType.None) 
            {
                infoLabel.text = currentToolDescription;
            }
            else
            {
                infoLabel.text = null;
            }
        }
    }

    public void StopAll()
    {

        foreach (GameObject btn in buttons)
        {
            btn.GetComponent<Tool>().Stop();     
        }
        SetTool(ToolType.None, null);
    }

    public void SetTool(ToolType t, string description)
    {
        currentTool = t;
        currentToolDescription = description;

        switch (t)
        {
            case ToolType.None:
                // stopBanner.SetActive(false);
                break;
            case ToolType.Draw:
                // stopBanner.SetActive(true);
                break;
            case ToolType.Erase:
                // stopBanner.SetActive(true);
                break;
        }

    }

    public static string GetToolDescription(ToolType tool)
    {
        switch (tool){
            case ToolType.Draw:
                return "Draw waypoints. Press ESC to stop.";
            case ToolType.Erase:
                return "Erase waypoints. Click on a waypoint to erase it. Press ESC to stop.";
            case ToolType.Reverse:
                return "Inverse flight.";
            case ToolType.NewScene:
                return "New plan.";
            case ToolType.SaveScene:
                return "Save plan.";
            case ToolType.LoadScene:
                return "Load plan.";
            case ToolType.Print:
                return "Print plan. Frame your view to the green region.";
        }
        return null;
    }

}
