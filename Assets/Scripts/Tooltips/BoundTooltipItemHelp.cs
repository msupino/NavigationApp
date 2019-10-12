using UnityEngine;
using UnityEngine.UI;
///Credit Martin Nerurkar // www.martin.nerurkar.de // www.sharkbombs.com
///Sourced from - http://www.sharkbombs.com/2015/02/10/tooltips-with-the-new-unity-ui-ugui/


public class BoundTooltipItemHelp : MonoBehaviour
{
    public bool IsActive
    {
        get
        {
            return gameObject.activeSelf;
        }
    }

    public TMPro.TextMeshProUGUI TooltipText;
    public Vector3 ToolTipOffset;

    void Awake()
    {
        instance = this;
        if(!TooltipText) TooltipText = GetComponentInChildren<TMPro.TextMeshProUGUI>();
        HideTooltip();
    }

    public void ShowTooltip(string text, Vector3 pos)
    {
        if (TooltipText.text != text)
            TooltipText.text = text;

        transform.position = pos + ToolTipOffset;

        gameObject.SetActive(true);
    }

    public void HideTooltip()
    {
        gameObject.SetActive(false);
    }

    // Standard Singleton Access
    private static BoundTooltipItemHelp instance;
    public static BoundTooltipItemHelp Instance
    {
        get
        {
            if (instance == null)
                instance = GameObject.FindObjectOfType<BoundTooltipItemHelp>();
            return instance;
        }
    }
}


 
