using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using UnityEngine.Animations;
using Tools;
using MainLogic;

public class Tool : MonoBehaviour
{
    public MainLoop main;
    public Tooltype tool;
    private Image image;
    public bool isActive = false;
    private KeyCode triggerKey;
    // Start is called before the first frame update


    void Start()
    {
        image = gameObject.GetComponent<Image>();
        image.color = new Color32(255, 255, 255, 100);
        gameObject.GetComponent<Button>().onClick.AddListener(Clicked);
        main.toolbar.buttons.Add(gameObject);

        switch (tool)
        {
            case Tooltype.Draw:
                triggerKey = KeyCode.D;
                break;
        }


        Refresh();
    }

    public void Update()
    {
        if (tool == Tooltype.None) return;

        if (Input.GetKeyDown(triggerKey))
        {
            if (main.toolbar.currentTool != tool) Enter();
        }
 
    }

    void Clicked()
    {
        isActive = !isActive;
        Refresh();
    }

    public void Stop()
    {
        image.color = new Color32(255, 255, 255, 100);
        this.isActive = false;

        switch (tool)
        {
            case (Tooltype.Draw):
                main.toolbar.eventStopDrawing.Invoke();
                break;
        }
    }

    public void Enter()
    {
        image.color = new Color32(255, 255, 255, 255);
        main.toolbar.SetTool(tool);
        switch (tool)
        {
            case (Tooltype.Draw):
                main.toolbar.eventDrawing.Invoke();
                break;
        }
        main.toolbar.currentTool = tool;
    }

    void Refresh()
    {
        if (isActive)
        {
            Enter();

            foreach (GameObject btn in main.toolbar.buttons)
            {
                if (btn != gameObject)
                {
                    btn.GetComponent<Tool>().Stop();
                }
            }
        }
        else
        {
            this.Stop();
            main.toolbar.currentTool = Tooltype.None;
        }
    }
    

}
