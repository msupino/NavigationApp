using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using UnityEngine.Animations;
using Tools;
using MainLogic;

public class Tool : MonoBehaviour,
    IPointerEnterHandler,
    IPointerExitHandler
{
    public MainLoop main;
    public Tooltype tool;
    public Texture2D cursorTexture;
    public CursorMode cursorMode = CursorMode.Auto;
    public Vector2 hotSpot = Vector2.zero;
    public bool isActive = false;

    private Image image;
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
        Cursor.SetCursor(null, Vector2.zero, cursorMode);

        // each button will have a different stop sequence
        switch (tool)
        {
            case (Tooltype.Draw):
                // if this is the current tool, invoke a stop for it.
                if (main.toolbar.currentTool == Tooltype.Draw)
                {
                    main.toolbar.eventStopDrawing.Invoke();
                }
                break;
        }
    }

    public void Enter()
    {
        image.color = new Color32(255, 255, 255, 255);
        
        switch (tool)
        {
            case (Tooltype.Draw):
                main.toolbar.eventDrawing.Invoke();
                main.toolbar.SetTool(tool);
                break;
        }

        Cursor.SetCursor(cursorTexture, hotSpot, cursorMode);

    }

    void Refresh()
    {
        if (isActive)
        {
            
            foreach (GameObject btn in main.toolbar.buttons)
            {
                if (btn != gameObject)
                {
                    btn.GetComponent<Tool>().Stop();
                }
            }

            Enter();
        }
        else
        {
            this.Stop();
            main.toolbar.SetTool(Tooltype.None);
        }
    }

    public void OnPointerEnter(PointerEventData eventData)
    {
        image.color = new Color32(255, 255, 255, 150);
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        if (isActive)
        {
            image.color = new Color32(255, 255, 255, 255);

        }
        else
        {
            image.color = new Color32(255, 255, 255, 100);
        }
    }
}
