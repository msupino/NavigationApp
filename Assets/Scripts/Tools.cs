using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Tools
{

    public enum Tooltype
    {
        None,
        Draw,
        Erase
    }

    public class Toolbar
    {
        public Tooltype currentTool;
        public List<GameObject> buttons = new List<GameObject>();

        public Toolbar()
        {

        }

        public void SetTool(Tooltype t)
        {
            currentTool = t;
            Debug.Log("The current tool is:" + t);
        }
    }

}