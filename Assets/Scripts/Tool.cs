using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.Animations;

[RequireComponent(typeof(Button))]
public class Tool : MonoBehaviour,  
    IPointerEnterHandler,
    IPointerExitHandler,
    IPointerDownHandler
{
    public Main main;
    public ToolType tool;
    public ButtonType typ;

    public Texture2D cursorTexture;
    public CursorMode cursorMode = CursorMode.Auto;
    public Vector2 hotSpot = Vector2.zero;
    public bool isActive = false;


    private Image image;
    private KeyCode triggerKey;

    // Start is called before the first frame update

    #if UNITY_WEBGL && !UNITY_EDITOR
    //
    // WebGL
    //
    void Start()
    {
        image = GetComponent<Image>();
        image.color = new Color32(255, 255, 255, 100);
        main.toolbar.buttons.Add(gameObject);

        switch (tool)
        {
            case ToolType.Draw:
                triggerKey = KeyCode.D;
                break;
            case ToolType.Erase:
                triggerKey = KeyCode.X;
                break;    
            case ToolType.Reverse:
                triggerKey = KeyCode.Z;
                break;
        }
        Refresh();
    }

    public void OnPointerDown(PointerEventData eventData)
    {
        Clicked();
    }
    #else
    //
    // Normal
    //
    void Start()
    {
        image = GetComponent<Image>();
        image.color = new Color32(255, 255, 255, 100);
        GetComponent<Button>().onClick.AddListener(Clicked);
        main.toolbar.buttons.Add(gameObject);

        switch (tool)
        {
            case ToolType.Draw:
                triggerKey = KeyCode.D;
                break;
            case ToolType.Erase:
                triggerKey = KeyCode.X;
                break;    
            case ToolType.Reverse:
                triggerKey = KeyCode.Z;
                break;
        }
        Refresh();
    }
    public void OnPointerDown(PointerEventData eventData){}
    #endif

    public void Update()
    {
        if (tool == ToolType.None) return;

        if (Input.GetKeyDown(triggerKey))
        {
            if (main.toolbar.currentTool != tool){
                isActive = true;
                Refresh();
            }
        }
 
    }

    void Clicked()
    {
        if (typ == ButtonType.Action)
        {
            if (main.toolbar.currentTool == ToolType.None)
            {
                main.toolbar.eventActionTriggered.Invoke(tool);
            }
            else
            {
                Debug.LogWarning("Unbale to invoke action while another tool is active");
            }
            return;
        }
        
        
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
            case (ToolType.Draw):
                // if this is the current tool, invoke a stop for it.
                if (main.toolbar.currentTool == ToolType.Draw)
                {
                    main.toolbar.eventStopDrawing.Invoke();
                }
                break;
            case (ToolType.Erase):
                // if this is the current tool, invoke a stop for it.
                if (main.toolbar.currentTool == ToolType.Erase)
                {
                    main.toolbar.eventStopErase.Invoke();
                }
                break;
        }
    }

    public void Enter()
    {
        image.color = new Color32(255, 255, 255, 255);
        
        switch (tool)
        {
            case (ToolType.Draw):
                main.toolbar.eventDrawing.Invoke();
                main.toolbar.SetTool(tool);
                break;
            case (ToolType.Erase):
                main.toolbar.eventErase.Invoke();
                main.toolbar.SetTool(tool);
                break;
        }

        //Cursor.SetCursor(cursorTexture, hotSpot, cursorMode);

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
            main.toolbar.SetTool(ToolType.None);
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
