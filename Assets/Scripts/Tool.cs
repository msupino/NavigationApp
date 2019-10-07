using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Tools;
using MainLogic;

public class Tool : MonoBehaviour
{
    public MainLoop main;
    public Tooltype tool;
    private Image image;
    public bool isActive = false;
    // Start is called before the first frame update


    void Start()
    {
        image = gameObject.GetComponent<Image>();
        image.color = new Color32(255, 255, 255, 100);
        gameObject.GetComponent<Button>().onClick.AddListener(Clicked);
        main.toolbar.buttons.Add(gameObject);
        Refresh();
    }

    void Clicked()
    {
        isActive = !isActive;
        Refresh();
    }

    void Refresh()
    {
        if (isActive)
        {
            image.color = new Color32(255, 255, 255, 255);
            main.toolbar.SetTool(tool);

            foreach (GameObject btn in main.toolbar.buttons)
            {
                if (btn != gameObject)
                {
                    btn.GetComponent<Image>().color = new Color32(255, 255, 255, 100);
                    btn.GetComponent<Tool>().isActive = false;

                }
            }
        }
    }
    

}
